#!/bin/sh

set -eu

base_url="${M3_API_BASE_URL:-http://127.0.0.1:3300/api/v1}"
storage_url="${M3_STORAGE_URL:-http://127.0.0.1:19000}"
bucket="${M3_STORAGE_BUCKET:-baby-mp-local}"
run_id="$(date +%s)-$$"

new_uuid() {
  node -e 'process.stdout.write(crypto.randomUUID())'
}

sha256_file() {
  node -e '
    const { createHash } = require("node:crypto");
    const { createReadStream } = require("node:fs");
    const hash = createHash("sha256");
    createReadStream(process.argv[1]).on("data", (chunk) => hash.update(chunk))
      .on("end", () => process.stdout.write(hash.digest("hex")));
  ' "$1"
}

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
    echo "M3 verification failed: ${label} returned ${actual}, expected ${expected}" >&2
    exit 1
  fi
}

assert_json() {
  file="$1"
  expression="$2"
  label="$3"
  if ! jq -e "$expression" "$file" >/dev/null; then
    echo "M3 verification failed: ${label} response did not match the contract" >&2
    exit 1
  fi
}

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

# Two valid synthetic PNGs. No real family data is used by this verifier.
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAADZSiLoAAAAGUlEQVR4nGP4z8DAwMDAxMDAwMDAwMAAAAwAAf8CBY0AAAAASUVORK5CYII=' \
  | base64 -d >"$temporary_directory/original.png"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZVZkAAAAASUVORK5CYII=' \
  | base64 -d >"$temporary_directory/replacement.png"
original_size="$(wc -c <"$temporary_directory/original.png" | tr -d ' ')"
original_sha="$(sha256_file "$temporary_directory/original.png")"

anonymous_status="$(curl -sS -o "$temporary_directory/anonymous.json" -w '%{http_code}' "${storage_url}/${bucket}")"
assert_status "$anonymous_status" 403 'anonymous bucket listing'

status="$(request POST /auth/mock-login \
  "{\"mockUserKey\":\"m3-admin-${run_id}\",\"displayName\":\"M3 Test Parent\"}" \
  '' '' "$temporary_directory/admin-login.json")"
assert_status "$status" 201 'admin mock login'
admin_access="$(jq -er '.data.accessToken' "$temporary_directory/admin-login.json")"

status="$(request POST /auth/mock-login \
  "{\"mockUserKey\":\"m3-outsider-${run_id}\",\"displayName\":\"M3 Test Outsider\"}" \
  '' '' "$temporary_directory/outsider-login.json")"
assert_status "$status" 201 'outsider mock login'
outsider_access="$(jq -er '.data.accessToken' "$temporary_directory/outsider-login.json")"

baby_key="$(new_uuid)"
baby_body='{"name":"M3 Synthetic Baby","gender":"unspecified","birthDate":"2025-01-01"}'
status="$(request POST /babies "$baby_body" "$admin_access" "$baby_key" "$temporary_directory/baby.json")"
assert_status "$status" 201 'baby creation'
baby_id="$(jq -er '.data.id' "$temporary_directory/baby.json")"

upload_body="{\"fileName\":\"synthetic.png\",\"mimeType\":\"image/png\",\"sizeBytes\":${original_size},\"sha256\":\"${original_sha}\"}"
status="$(request POST "/babies/${baby_id}/media/uploads" "$upload_body" "$admin_access" '' "$temporary_directory/upload.json")"
assert_status "$status" 201 'media upload authorization'
media_id="$(jq -er '.data.mediaId' "$temporary_directory/upload.json")"
upload_url="$(jq -er '.data.upload.url' "$temporary_directory/upload.json")"

put_status="$(curl -sS -o "$temporary_directory/put.txt" -w '%{http_code}' -X PUT \
  -H 'Content-Type: image/png' --data-binary "@$temporary_directory/original.png" "$upload_url")"
assert_status "$put_status" 200 'signed media PUT'

status="$(request POST "/media/${media_id}/complete" '{"width":999,"height":999}' \
  "$admin_access" '' "$temporary_directory/complete.json")"
assert_status "$status" 200 'media completion'
assert_json "$temporary_directory/complete.json" \
  '.data.status == "ready" and .data.width == 2 and .data.height == 3 and (.data.accessUrl | type == "string")' \
  'server-side image validation'
access_url="$(jq -er '.data.accessUrl' "$temporary_directory/complete.json")"

get_status="$(curl -sS -o "$temporary_directory/downloaded.png" -w '%{http_code}' "$access_url")"
assert_status "$get_status" 200 'signed media GET'
downloaded_sha="$(sha256_file "$temporary_directory/downloaded.png")"
if [ "$downloaded_sha" != "$original_sha" ]; then
  echo 'M3 verification failed: signed GET bytes differ from uploaded bytes' >&2
  exit 1
fi

# The old PUT URL only targets quarantine. It must not overwrite the immutable ready object.
curl -sS -o "$temporary_directory/overwrite.txt" -X PUT -H 'Content-Type: image/png' \
  --data-binary "@$temporary_directory/replacement.png" "$upload_url"
curl -sS -o "$temporary_directory/after-overwrite.png" "$access_url"
after_overwrite_sha="$(sha256_file "$temporary_directory/after-overwrite.png")"
if [ "$after_overwrite_sha" != "$original_sha" ]; then
  echo 'M3 verification failed: expired quarantine PUT path changed the ready object' >&2
  exit 1
fi

occurred_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
note_key="$(new_uuid)"
note_body="{\"type\":\"note\",\"occurredAt\":\"${occurred_at}\",\"content\":\"M3 synthetic note\",\"mediaIds\":[\"${media_id}\"]}"
status="$(request POST "/babies/${baby_id}/records" "$note_body" "$admin_access" "$note_key" "$temporary_directory/note.json")"
assert_status "$status" 201 'note creation'
note_id="$(jq -er '.data.id' "$temporary_directory/note.json")"
assert_json "$temporary_directory/note.json" '.data.type == "note" and (.data.media | length) == 1' 'note creation'

status="$(request POST "/babies/${baby_id}/records" "$note_body" "$admin_access" "$note_key" "$temporary_directory/note-replay.json")"
assert_status "$status" 201 'note idempotent replay'
assert_json "$temporary_directory/note-replay.json" ".data.id == \"${note_id}\"" 'note idempotent replay'

conflicting_note="{\"type\":\"note\",\"occurredAt\":\"${occurred_at}\",\"content\":\"different\",\"mediaIds\":[\"${media_id}\"]}"
status="$(request POST "/babies/${baby_id}/records" "$conflicting_note" "$admin_access" "$note_key" "$temporary_directory/note-conflict.json")"
assert_status "$status" 409 'record idempotency conflict'

measurement_key="$(new_uuid)"
measurement_body="{\"type\":\"measurement\",\"occurredAt\":\"${occurred_at}\",\"content\":\"synthetic\",\"measurement\":{\"heightCm\":80.25,\"weightKg\":10.125},\"mediaIds\":[]}"
status="$(request POST "/babies/${baby_id}/records" "$measurement_body" "$admin_access" "$measurement_key" "$temporary_directory/measurement.json")"
assert_status "$status" 201 'measurement creation'
measurement_id="$(jq -er '.data.id' "$temporary_directory/measurement.json")"

milestone_key="$(new_uuid)"
milestone_body="{\"type\":\"milestone\",\"occurredAt\":\"${occurred_at}\",\"title\":\"M3 synthetic milestone\",\"mediaIds\":[]}"
status="$(request POST "/babies/${baby_id}/records" "$milestone_body" "$admin_access" "$milestone_key" "$temporary_directory/milestone.json")"
assert_status "$status" 201 'milestone creation'
milestone_id="$(jq -er '.data.id' "$temporary_directory/milestone.json")"

status="$(request GET "/babies/${baby_id}/records?limit=2" '{}' "$admin_access" '' "$temporary_directory/timeline-first.json")"
assert_status "$status" 200 'timeline first page'
assert_json "$temporary_directory/timeline-first.json" '.data | length == 2' 'timeline first page'
cursor="$(jq -er '.meta.nextCursor' "$temporary_directory/timeline-first.json")"
status="$(request GET "/babies/${baby_id}/records?limit=2&cursor=${cursor}" '{}' "$admin_access" '' "$temporary_directory/timeline-second.json")"
assert_status "$status" 200 'timeline cursor page'
assert_json "$temporary_directory/timeline-second.json" '.data | length == 1' 'timeline cursor page'

status="$(request GET "/babies/${baby_id}/records?type=measurement&limit=20" '{}' "$admin_access" '' "$temporary_directory/measurement-filter.json")"
assert_status "$status" 200 'timeline type filter'
assert_json "$temporary_directory/measurement-filter.json" ".data | length == 1 and .[0].id == \"${measurement_id}\"" 'timeline type filter'

status="$(request PATCH "/records/${note_id}" '{"version":1,"content":"M3 synthetic note updated"}' \
  "$admin_access" '' "$temporary_directory/note-update.json")"
assert_status "$status" 200 'record update'
assert_json "$temporary_directory/note-update.json" '.data.version == 2 and .data.content == "M3 synthetic note updated"' 'record update'
status="$(request PATCH "/records/${note_id}" '{"version":1,"content":"stale"}' \
  "$admin_access" '' "$temporary_directory/note-stale.json")"
assert_status "$status" 409 'record optimistic version conflict'

status="$(request GET "/records/${note_id}" '{}' "$outsider_access" '' "$temporary_directory/outsider-record.json")"
assert_status "$status" 404 'outsider record read'
status="$(request GET "/media/${media_id}" '{}' "$outsider_access" '' "$temporary_directory/outsider-media.json")"
assert_status "$status" 404 'outsider media read'

second_baby_key="$(new_uuid)"
status="$(request POST /babies '{"name":"M3 Synthetic Baby Two","gender":"unspecified","birthDate":"2025-01-01"}' \
  "$admin_access" "$second_baby_key" "$temporary_directory/second-baby.json")"
assert_status "$status" 201 'second baby creation'
second_baby_id="$(jq -er '.data.id' "$temporary_directory/second-baby.json")"
status="$(request POST "/babies/${second_baby_id}/records" "$note_body" "$admin_access" \
  "$(new_uuid)" "$temporary_directory/cross-baby-media.json")"
assert_status "$status" 404 'cross-baby media attachment'
status="$(request GET "/babies/${second_baby_id}/records?limit=20" '{}' "$admin_access" '' "$temporary_directory/second-timeline.json")"
assert_status "$status" 200 'second baby timeline'
assert_json "$temporary_directory/second-timeline.json" '.data | length == 0' 'multi-baby timeline isolation'

status="$(request DELETE "/records/${milestone_id}?version=1" '{}' "$admin_access" '' "$temporary_directory/delete.json")"
assert_status "$status" 204 'record soft delete'
status="$(request GET "/records/${milestone_id}" '{}' "$admin_access" '' "$temporary_directory/deleted-record.json")"
assert_status "$status" 404 'soft-deleted record read'

echo 'M3 API verification passed: private media, immutable promotion, three record types, idempotency, timeline pagination/filtering, versions, soft deletion, outsider and multi-baby isolation.'
