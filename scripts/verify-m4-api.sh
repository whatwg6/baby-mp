#!/bin/sh

set -eu

base_url="${M4_API_BASE_URL:-http://127.0.0.1:3300/api/v1}"
run_id="$(date +%s)-$$"

request() {
  method="$1"
  path="$2"
  body="$3"
  authorization="${4:-}"
  idempotency="${5:-}"
  output_file="$6"

  set -- -sS -o "$output_file" -w '%{http_code}' -X "$method" \
    -H 'Accept: application/json' -H 'Content-Type: application/json'
  if [ -n "$authorization" ]; then
    set -- "$@" -H "Authorization: Bearer ${authorization}"
  fi
  if [ -n "$idempotency" ]; then
    set -- "$@" -H "Idempotency-Key: ${idempotency}"
  fi
  curl "$@" --data "$body" "${base_url}${path}"
}

assert_status() {
  actual="$1"
  expected="$2"
  label="$3"
  if [ "$actual" != "$expected" ]; then
    echo "M4 verification failed: ${label} returned ${actual}, expected ${expected}" >&2
    exit 1
  fi
}

assert_json() {
  file="$1"
  expression="$2"
  label="$3"
  if ! jq -e "$expression" "$file" >/dev/null; then
    echo "M4 verification failed: ${label} response did not match the contract" >&2
    exit 1
  fi
}

new_uuid() {
  node -e 'process.stdout.write(crypto.randomUUID())'
}

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

status="$(request POST /auth/mock-login \
  "{\"mockUserKey\":\"m4-admin-${run_id}\",\"displayName\":\"M4 Test Parent\"}" \
  '' '' "$temporary_directory/admin-login.json")"
assert_status "$status" 201 'admin mock login'
admin_access="$(jq -er '.data.accessToken' "$temporary_directory/admin-login.json")"

status="$(request POST /auth/mock-login \
  "{\"mockUserKey\":\"m4-outsider-${run_id}\",\"displayName\":\"M4 Test Outsider\"}" \
  '' '' "$temporary_directory/outsider-login.json")"
assert_status "$status" 201 'outsider mock login'
outsider_access="$(jq -er '.data.accessToken' "$temporary_directory/outsider-login.json")"

# Birth measurements deliberately differ from every record value. They must not appear in growth series.
baby_body='{"name":"M4 Synthetic Baby","gender":"unspecified","birthDate":"2025-01-01","birthHeightCm":49.5,"birthWeightKg":3.25}'
status="$(request POST /babies "$baby_body" "$admin_access" "$(new_uuid)" "$temporary_directory/baby.json")"
assert_status "$status" 201 'baby creation'
baby_id="$(jq -er '.data.id' "$temporary_directory/baby.json")"

height_time='2026-01-01T08:00:00.000Z'
weight_time='2026-01-02T08:00:00.000Z'
shared_time='2026-01-03T08:00:00.000Z'

height_body="{\"type\":\"measurement\",\"occurredAt\":\"${height_time}\",\"measurement\":{\"heightCm\":80.25,\"weightKg\":null},\"mediaIds\":[]}"
status="$(request POST "/babies/${baby_id}/records" "$height_body" "$admin_access" "$(new_uuid)" "$temporary_directory/height-only.json")"
assert_status "$status" 201 'height-only measurement creation'
height_id="$(jq -er '.data.id' "$temporary_directory/height-only.json")"

weight_body="{\"type\":\"measurement\",\"occurredAt\":\"${weight_time}\",\"measurement\":{\"heightCm\":null,\"weightKg\":10.125},\"mediaIds\":[]}"
status="$(request POST "/babies/${baby_id}/records" "$weight_body" "$admin_access" "$(new_uuid)" "$temporary_directory/weight-only.json")"
assert_status "$status" 201 'weight-only measurement creation'
weight_id="$(jq -er '.data.id' "$temporary_directory/weight-only.json")"

dual_one_body="{\"type\":\"measurement\",\"occurredAt\":\"${shared_time}\",\"measurement\":{\"heightCm\":82.5,\"weightKg\":11.25},\"mediaIds\":[]}"
status="$(request POST "/babies/${baby_id}/records" "$dual_one_body" "$admin_access" "$(new_uuid)" "$temporary_directory/dual-one.json")"
assert_status "$status" 201 'first dual measurement creation'
dual_one_id="$(jq -er '.data.id' "$temporary_directory/dual-one.json")"

dual_two_body="{\"type\":\"measurement\",\"occurredAt\":\"${shared_time}\",\"measurement\":{\"heightCm\":83.0,\"weightKg\":11.5},\"mediaIds\":[]}"
status="$(request POST "/babies/${baby_id}/records" "$dual_two_body" "$admin_access" "$(new_uuid)" "$temporary_directory/dual-two.json")"
assert_status "$status" 201 'second same-time dual measurement creation'
dual_two_id="$(jq -er '.data.id' "$temporary_directory/dual-two.json")"

status="$(request GET "/babies/${baby_id}/growth/measurements?metric=height" '{}' "$admin_access" '' "$temporary_directory/heights.json")"
assert_status "$status" 200 'height growth query'
assert_json "$temporary_directory/heights.json" \
  ".data.metric == \"height\" and .data.unit == \"cm\" and (.data.points | length) == 3 and .data.points[0].recordId == \"${height_id}\" and .data.points[0].value == 80.25 and (.data.points | map(.recordId))[1:3] == ([\"${dual_one_id}\",\"${dual_two_id}\"] | sort) and (.data.points | map(.value) | index(49.5)) == null" \
  'height values, birth exclusion, and stable ascending order'

status="$(request GET "/babies/${baby_id}/growth/measurements?metric=weight" '{}' "$admin_access" '' "$temporary_directory/weights.json")"
assert_status "$status" 200 'weight growth query'
assert_json "$temporary_directory/weights.json" \
  ".data.metric == \"weight\" and .data.unit == \"kg\" and (.data.points | length) == 3 and .data.points[0].recordId == \"${weight_id}\" and .data.points[0].value == 10.125 and (.data.points | map(.recordId))[1:3] == ([\"${dual_one_id}\",\"${dual_two_id}\"] | sort) and (.data.points | map(.value) | index(3.25)) == null" \
  'weight values, birth exclusion, and stable ascending order'

# Equal start/end boundaries are inclusive and retain every same-time point in id order.
status="$(request GET "/babies/${baby_id}/growth/measurements?metric=height&startAt=${shared_time}&endAt=${shared_time}" '{}' "$admin_access" '' "$temporary_directory/inclusive.json")"
assert_status "$status" 200 'inclusive exact-time range'
assert_json "$temporary_directory/inclusive.json" \
  ".data.points | map(.recordId) == ([\"${dual_one_id}\",\"${dual_two_id}\"] | sort)" \
  'inclusive range and same-time stable order'

status="$(request PATCH "/records/${dual_one_id}" \
  '{"version":1,"measurement":{"heightCm":84.75,"weightKg":12.345}}' \
  "$admin_access" '' "$temporary_directory/updated.json")"
assert_status "$status" 200 'measurement update'
assert_json "$temporary_directory/updated.json" \
  '.data.version == 2 and .data.measurement.heightCm == 84.75 and .data.measurement.weightKg == 12.345' \
  'measurement update response'

status="$(request GET "/babies/${baby_id}/growth/measurements?metric=height" '{}' "$admin_access" '' "$temporary_directory/heights-updated.json")"
assert_status "$status" 200 'height query after edit'
assert_json "$temporary_directory/heights-updated.json" \
  ".data.points[] | select(.recordId == \"${dual_one_id}\") | .value == 84.75" \
  'height synchronization after edit'
status="$(request GET "/babies/${baby_id}/growth/measurements?metric=weight" '{}' "$admin_access" '' "$temporary_directory/weights-updated.json")"
assert_status "$status" 200 'weight query after edit'
assert_json "$temporary_directory/weights-updated.json" \
  ".data.points[] | select(.recordId == \"${dual_one_id}\") | .value == 12.345" \
  'weight synchronization after edit'

status="$(request DELETE "/records/${dual_two_id}?version=1" '{}' "$admin_access" '' "$temporary_directory/deleted.json")"
assert_status "$status" 204 'measurement deletion'
status="$(request GET "/babies/${baby_id}/growth/measurements?metric=height" '{}' "$admin_access" '' "$temporary_directory/heights-deleted.json")"
assert_status "$status" 200 'height query after delete'
assert_json "$temporary_directory/heights-deleted.json" \
  "(.data.points | length) == 2 and (.data.points | map(.recordId) | index(\"${dual_two_id}\")) == null" \
  'height synchronization after delete'
status="$(request GET "/babies/${baby_id}/growth/measurements?metric=weight" '{}' "$admin_access" '' "$temporary_directory/weights-deleted.json")"
assert_status "$status" 200 'weight query after delete'
assert_json "$temporary_directory/weights-deleted.json" \
  "(.data.points | length) == 2 and (.data.points | map(.recordId) | index(\"${dual_two_id}\")) == null" \
  'weight synchronization after delete'

status="$(request GET "/babies/${baby_id}/growth/measurements?metric=height" '{}' "$outsider_access" '' "$temporary_directory/outsider.json")"
assert_status "$status" 404 'outsider growth query'
assert_json "$temporary_directory/outsider.json" '.error.code == "RESOURCE_NOT_FOUND" and (.data == null)' 'outsider non-disclosure'

second_baby_body='{"name":"M4 Synthetic Baby Two","gender":"unspecified","birthDate":"2025-01-01"}'
status="$(request POST /babies "$second_baby_body" "$admin_access" "$(new_uuid)" "$temporary_directory/second-baby.json")"
assert_status "$status" 201 'second baby creation'
second_baby_id="$(jq -er '.data.id' "$temporary_directory/second-baby.json")"
second_body="{\"type\":\"measurement\",\"occurredAt\":\"${height_time}\",\"measurement\":{\"heightCm\":99.99,\"weightKg\":null},\"mediaIds\":[]}"
status="$(request POST "/babies/${second_baby_id}/records" "$second_body" "$admin_access" "$(new_uuid)" "$temporary_directory/second-measurement.json")"
assert_status "$status" 201 'second baby measurement creation'
second_record_id="$(jq -er '.data.id' "$temporary_directory/second-measurement.json")"

status="$(request GET "/babies/${second_baby_id}/growth/measurements?metric=height" '{}' "$admin_access" '' "$temporary_directory/second-heights.json")"
assert_status "$status" 200 'second baby growth query'
assert_json "$temporary_directory/second-heights.json" \
  ".data.points | length == 1 and .[0].recordId == \"${second_record_id}\" and .[0].value == 99.99" \
  'second baby isolated series'
status="$(request GET "/babies/${baby_id}/growth/measurements?metric=height" '{}' "$admin_access" '' "$temporary_directory/first-heights-final.json")"
assert_status "$status" 200 'first baby final growth query'
assert_json "$temporary_directory/first-heights-final.json" \
  "(.data.points | map(.recordId) | index(\"${second_record_id}\")) == null" \
  'cross-baby isolation'

echo 'M4 API verification passed: height/weight series, inclusive ranges, stable ordering, edit/delete synchronization, outsider denial, and multi-baby isolation.'
