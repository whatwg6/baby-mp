#!/bin/sh

set -eu

base_url="${M2_API_BASE_URL:-http://127.0.0.1:3300/api/v1}"
run_id="$(date +%s)-$$"
admin_key="m2-admin-${run_id}"
outsider_key="m2-outsider-${run_id}"
idempotency_key="$(node -e 'process.stdout.write(crypto.randomUUID())')"

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
    echo "M2 verification failed: ${label} returned ${actual}, expected ${expected}" >&2
    exit 1
  fi
}

assert_json() {
  file="$1"
  expression="$2"
  label="$3"
  if ! jq -e "$expression" "$file" >/dev/null; then
    echo "M2 verification failed: ${label} response did not match the contract" >&2
    exit 1
  fi
}

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

status="$(request GET /babies '{}' '' '' "$temporary_directory/unauthorized.json")"
assert_status "$status" 401 'unauthenticated babies list'
assert_json "$temporary_directory/unauthorized.json" '.error.code == "AUTH_REQUIRED" and (.data == null)' 'unauthenticated babies list'

status="$(request POST /auth/mock-login "{\"mockUserKey\":\"${admin_key}\",\"displayName\":\"M2 Test Parent\"}" '' '' "$temporary_directory/admin-login.json")"
assert_status "$status" 201 'admin mock login'
admin_access="$(jq -er '.data.accessToken' "$temporary_directory/admin-login.json")"
admin_refresh="$(jq -er '.data.refreshToken' "$temporary_directory/admin-login.json")"
admin_user_id="$(jq -er '.data.user.id' "$temporary_directory/admin-login.json")"

status="$(request POST /auth/mock-login "{\"mockUserKey\":\"${admin_key}\",\"displayName\":\"M2 Test Parent\"}" '' '' "$temporary_directory/admin-login-repeat.json")"
assert_status "$status" 201 'repeated mock login'
assert_json "$temporary_directory/admin-login-repeat.json" ".data.user.id == \"${admin_user_id}\"" 'repeated mock login'
second_refresh="$(jq -er '.data.refreshToken' "$temporary_directory/admin-login-repeat.json")"

status="$(request POST /auth/mock-login "{\"mockUserKey\":\"${outsider_key}\",\"displayName\":\"M2 Outsider\"}" '' '' "$temporary_directory/outsider-login.json")"
assert_status "$status" 201 'outsider mock login'
outsider_access="$(jq -er '.data.accessToken' "$temporary_directory/outsider-login.json")"

baby_body='{"name":"M2 Synthetic Baby","gender":"unspecified","birthDate":"2025-01-01","birthTime":null,"birthHeightCm":50.2,"birthWeightKg":3.42}'
status="$(request POST /babies "$baby_body" "$admin_access" "$idempotency_key" "$temporary_directory/baby-create.json")"
assert_status "$status" 201 'baby creation'
baby_id="$(jq -er '.data.id' "$temporary_directory/baby-create.json")"
assert_json "$temporary_directory/baby-create.json" '.data.role == "admin" and .data.version == 1' 'baby creation'

status="$(request POST /babies "$baby_body" "$admin_access" "$idempotency_key" "$temporary_directory/baby-replay.json")"
assert_status "$status" 201 'baby idempotent replay'
assert_json "$temporary_directory/baby-replay.json" ".data.id == \"${baby_id}\"" 'baby idempotent replay'

different_body='{"name":"Different Synthetic Baby","gender":"unspecified","birthDate":"2025-01-01"}'
status="$(request POST /babies "$different_body" "$admin_access" "$idempotency_key" "$temporary_directory/baby-conflict.json")"
assert_status "$status" 409 'idempotency conflict'
assert_json "$temporary_directory/baby-conflict.json" '.error.code == "IDEMPOTENCY_CONFLICT"' 'idempotency conflict'

status="$(request GET "/babies/${baby_id}" '{}' "$outsider_access" '' "$temporary_directory/outsider-baby.json")"
assert_status "$status" 404 'outsider baby read'
assert_json "$temporary_directory/outsider-baby.json" '.error.code == "RESOURCE_NOT_FOUND" and (.data == null)' 'outsider baby read'

status="$(request PATCH "/babies/${baby_id}" '{"version":1,"name":"M2 Updated Baby"}' "$admin_access" '' "$temporary_directory/baby-update.json")"
assert_status "$status" 200 'baby update'
assert_json "$temporary_directory/baby-update.json" '.data.version == 2 and .data.name == "M2 Updated Baby"' 'baby update'

status="$(request PATCH "/babies/${baby_id}" '{"version":1,"name":"M2 Stale Update"}' "$admin_access" '' "$temporary_directory/version-conflict.json")"
assert_status "$status" 409 'baby version conflict'
assert_json "$temporary_directory/version-conflict.json" '.error.code == "VERSION_CONFLICT"' 'baby version conflict'

status="$(request POST /auth/refresh "{\"refreshToken\":\"${admin_refresh}\"}" '' '' "$temporary_directory/refresh.json")"
assert_status "$status" 201 'refresh rotation'
rotated_refresh="$(jq -er '.data.refreshToken' "$temporary_directory/refresh.json")"

status="$(request POST /auth/refresh "{\"refreshToken\":\"${admin_refresh}\"}" '' '' "$temporary_directory/replay.json")"
assert_status "$status" 401 'old refresh replay'
assert_json "$temporary_directory/replay.json" '.error.code == "REFRESH_TOKEN_INVALID"' 'old refresh replay'

status="$(request POST /auth/refresh "{\"refreshToken\":\"${rotated_refresh}\"}" '' '' "$temporary_directory/family-revoked.json")"
assert_status "$status" 401 'refresh family revocation'
assert_json "$temporary_directory/family-revoked.json" '.error.code == "REFRESH_TOKEN_INVALID"' 'refresh family revocation'

status="$(request POST /auth/logout "{\"refreshToken\":\"${second_refresh}\"}" '' '' "$temporary_directory/logout.json")"
assert_status "$status" 204 'logout'
status="$(request POST /auth/refresh "{\"refreshToken\":\"${second_refresh}\"}" '' '' "$temporary_directory/logout-refresh.json")"
assert_status "$status" 401 'logged-out refresh rejection'
assert_json "$temporary_directory/logout-refresh.json" '.error.code == "REFRESH_TOKEN_INVALID"' 'logged-out refresh rejection'

echo 'M2 API verification passed: auth, session rotation/replay, baby transaction surface, idempotency, versioning, and outsider isolation.'
