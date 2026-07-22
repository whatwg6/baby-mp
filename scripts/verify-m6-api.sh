#!/usr/bin/env bash
set -euo pipefail

umask 077

API_BASE_URL="${M6_API_BASE_URL:-http://127.0.0.1:3300/api/v1}"
STORAGE_BASE_URL="${M6_STORAGE_URL:-http://127.0.0.1:19000}"
STORAGE_BUCKET="${S3_BUCKET:-baby-mp-local}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
: "${S3_FORCE_PATH_STYLE:?S3_FORCE_PATH_STYLE is required}"

for command in curl jq node unzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if command -v psql >/dev/null 2>&1; then
  db_query() {
    psql "$DATABASE_URL" --no-psqlrc "$@"
  }
elif command -v docker >/dev/null 2>&1 && [[ -n "${M6_PSQL_CONTAINER:-}" ]]; then
  db_query() {
    docker exec "$M6_PSQL_CONTAINER" psql \
      -U "${M6_POSTGRES_USER:-baby_mp}" \
      -d "${M6_POSTGRES_DB:-baby_mp}" \
      --no-psqlrc "$@"
  }
else
  echo 'Missing psql; alternatively set M6_PSQL_CONTAINER for a local PostgreSQL container' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-m6-verify.XXXXXX")"
cleanup() {
  if [[ "${M6_KEEP_WORK_DIR:-false}" == 'true' ]]; then
    echo "Preserved verifier artifacts at $work_dir" >&2
  else
    rm -rf "$work_dir"
  fi
}
trap cleanup EXIT

uuid() {
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

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label failed: expected HTTP $expected, got $actual" >&2
    exit 1
  fi
}

request() {
  local method="$1"
  local path="$2"
  local body="$3"
  local token="$4"
  local key="$5"
  local output="$6"
  local args=(
    --silent --show-error
    --request "$method"
    --output "$output"
    --write-out '%{http_code}'
    --header 'accept: application/json'
  )
  if [[ -n "$body" ]]; then
    args+=(--header 'content-type: application/json' --data "$body")
  fi
  if [[ -n "$token" ]]; then
    args+=(--header "authorization: Bearer $token")
  fi
  if [[ -n "$key" ]]; then
    args+=(--header "idempotency-key: $key")
  fi
  curl "${args[@]}" "${API_BASE_URL}${path}"
}

login() {
  local key="$1"
  local output="$work_dir/login-$key.json"
  local status
  status="$(request POST /auth/mock-login \
    "{\"mockUserKey\":\"m6-$key\",\"displayName\":\"M6 synthetic $key\"}" '' '' "$output")"
  assert_status "$status" 201 "Mock login ($key)"
  jq --exit-status --raw-output '.data.accessToken' "$output"
}

run_id="$(date +%s)-$(uuid)"
admin_token="$(login "admin-$run_id")"
editor_token="$(login "editor-$run_id")"
outsider_token="$(login "outsider-$run_id")"

baby_key="$(uuid)"
status="$(request POST /babies \
  '{"name":"M6 synthetic baby","gender":"unspecified","birthDate":"2025-01-01"}' \
  "$admin_token" "$baby_key" "$work_dir/baby.json")"
assert_status "$status" 201 'Baby creation'
baby_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/baby.json")"

other_key="$(uuid)"
status="$(request POST /babies \
  '{"name":"M6 isolation baby","gender":"unspecified","birthDate":"2025-02-02"}' \
  "$outsider_token" "$other_key" "$work_dir/other-baby.json")"
assert_status "$status" 201 'Isolation baby creation'
other_baby_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/other-baby.json")"

status="$(request POST "/babies/$baby_id/invites" \
  '{"role":"editor","expiresInHours":24}' "$admin_token" "$(uuid)" "$work_dir/invite.json")"
assert_status "$status" 201 'Editor invite creation'
invite_token="$(jq --exit-status --raw-output '.data.token' "$work_dir/invite.json")"
status="$(request POST /invites/accept \
  "{\"token\":\"$invite_token\"}" "$editor_token" "$(uuid)" "$work_dir/invite-accept.json")"
assert_status "$status" 200 'Editor invite acceptance'

printf '%s' \
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAADZSiLoAAAAGUlEQVR4nGP4z8DAwMDAxMDAwMDAwMAAAAwAAf8CBY0AAAAASUVORK5CYII=' \
  | base64 -d >"$work_dir/synthetic.png"
image_size="$(wc -c <"$work_dir/synthetic.png" | tr -d ' ')"
image_sha="$(sha256_file "$work_dir/synthetic.png")"
status="$(request POST "/babies/$baby_id/media/uploads" \
  "{\"fileName\":\"synthetic.png\",\"mimeType\":\"image/png\",\"sizeBytes\":$image_size,\"sha256\":\"$image_sha\"}" \
  "$admin_token" '' "$work_dir/upload.json")"
assert_status "$status" 201 'Media upload authorization'
media_id="$(jq --exit-status --raw-output '.data.mediaId' "$work_dir/upload.json")"
upload_url="$(jq --exit-status --raw-output '.data.upload.url' "$work_dir/upload.json")"
put_status="$(curl --silent --show-error --request PUT --header 'content-type: image/png' \
  --data-binary "@$work_dir/synthetic.png" --output "$work_dir/upload-result.txt" \
  --write-out '%{http_code}' "$upload_url")"
assert_status "$put_status" 200 'Signed media upload'
status="$(request POST "/media/$media_id/complete" '{"width":2,"height":3}' \
  "$admin_token" '' "$work_dir/media-complete.json")"
assert_status "$status" 200 'Media completion'

occurred_at='2026-07-18T02:00:00.000Z'
status="$(request POST "/babies/$baby_id/records" \
  "{\"type\":\"note\",\"occurredAt\":\"$occurred_at\",\"content\":\" =M6 CSV probe\",\"mediaIds\":[\"$media_id\"]}" \
  "$admin_token" "$(uuid)" "$work_dir/note.json")"
assert_status "$status" 201 'Note creation'
note_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/note.json")"

status="$(request POST "/babies/$baby_id/records" \
  "{\"type\":\"measurement\",\"occurredAt\":\"$occurred_at\",\"content\":\"M6 measurement\",\"measurement\":{\"heightCm\":80.25,\"weightKg\":10.125},\"mediaIds\":[]}" \
  "$admin_token" "$(uuid)" "$work_dir/measurement.json")"
assert_status "$status" 201 'Measurement creation'
measurement_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/measurement.json")"

status="$(request POST "/babies/$baby_id/records" \
  "{\"type\":\"milestone\",\"occurredAt\":\"$occurred_at\",\"title\":\"M6 deleted probe\",\"mediaIds\":[]}" \
  "$admin_token" "$(uuid)" "$work_dir/deleted.json")"
assert_status "$status" 201 'Deleted-record probe creation'
deleted_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/deleted.json")"
deleted_version="$(jq --exit-status --raw-output '.data.version' "$work_dir/deleted.json")"
status="$(request DELETE "/records/$deleted_id?version=$deleted_version" '' \
  "$admin_token" '' "$work_dir/deleted-result.txt")"
assert_status "$status" 204 'Deleted-record probe removal'

status="$(request POST "/babies/$other_baby_id/records" \
  "{\"type\":\"note\",\"occurredAt\":\"$occurred_at\",\"content\":\"M6 other-baby secret\",\"mediaIds\":[]}" \
  "$outsider_token" "$(uuid)" "$work_dir/other-note.json")"
assert_status "$status" 201 'Cross-baby probe creation'
other_note_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/other-note.json")"

export_key="$(uuid)"
status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":true,"format":"zip"}' "$admin_token" "$export_key" "$work_dir/export.json")"
assert_status "$status" 201 'Export creation'
export_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/export.json")"
jq --exit-status '.data.status == "pending" and .data.downloadUrl == null' \
  "$work_dir/export.json" >/dev/null

status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":true,"format":"zip"}' "$admin_token" "$export_key" "$work_dir/export-replay.json")"
assert_status "$status" 201 'Export idempotent replay'
[[ "$(jq --exit-status --raw-output '.data.id' "$work_dir/export-replay.json")" == "$export_id" ]]

status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":false,"format":"zip"}' "$admin_token" "$export_key" "$work_dir/export-conflict.json")"
assert_status "$status" 409 'Export same-key conflict'
status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":true,"format":"zip"}' "$admin_token" "$(uuid)" "$work_dir/export-active.json")"
assert_status "$status" 429 'Single active export limit'
status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":true,"format":"zip"}' "$editor_token" "$(uuid)" "$work_dir/export-editor.json")"
assert_status "$status" 403 'Editor export denial'
status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":true,"format":"zip"}' "$outsider_token" "$(uuid)" "$work_dir/export-outsider.json")"
assert_status "$status" 404 'Outsider export isolation'

(
  cd "$repo_root"
  pnpm --filter @baby-mp/api exec tsx src/exports/run-export-worker.ts --once \
    >"$work_dir/worker.json"
)
tail -n 1 "$work_dir/worker.json" | jq --exit-status '.processed == true' >/dev/null

status="$(request GET "/exports/$export_id" '' "$admin_token" '' "$work_dir/export-completed.json")"
assert_status "$status" 200 'Completed export detail'
jq --exit-status '
  .data.status == "completed" and
  .data.downloadUrl == null and
  (.data.expiresAt | type == "string")
' "$work_dir/export-completed.json" >/dev/null
status="$(request GET "/babies/$baby_id/exports?limit=1" '' \
  "$admin_token" '' "$work_dir/export-list.json")"
assert_status "$status" 200 'Export list'
jq --exit-status '.data[0].id == $id and .data[0].downloadUrl == null' \
  --arg id "$export_id" "$work_dir/export-list.json" >/dev/null

status="$(request POST "/exports/$export_id/download-url" '{}' \
  "$admin_token" '' "$work_dir/download-url.json")"
assert_status "$status" 200 'Export download URL'
download_url="$(jq --exit-status --raw-output '.data.downloadUrl' "$work_dir/download-url.json")"
curl --silent --show-error --fail "$download_url" --output "$work_dir/export.zip"
unzip -t "$work_dir/export.zip" >/dev/null
unzip -q "$work_dir/export.zip" -d "$work_dir/archive"

jq --exit-status \
  --arg baby "$baby_id" \
  --arg note "$note_id" \
  --arg measurement "$measurement_id" \
  --arg deleted "$deleted_id" \
  --arg other "$other_note_id" \
  '
    .baby.id == $baby and
    ([.records[].id] | index($note) != null) and
    ([.records[].id] | index($measurement) != null) and
    ([.records[].id] | index($deleted) == null) and
    ([.records[].id] | index($other) == null) and
    (.media | length == 1) and
    .media[0].included == true
  ' "$work_dir/archive/json/export.json" >/dev/null
test -f "$work_dir/archive/media/$media_id.png"
cmp "$work_dir/synthetic.png" "$work_dir/archive/media/$media_id.png"
grep -F "\"'=M6 CSV probe\"" "$work_dir/archive/csv/records.csv" >/dev/null
if grep -R -F 'M6 other-baby secret' "$work_dir/archive" >/dev/null; then
  echo 'Cross-baby content leaked into export' >&2
  exit 1
fi

# EXP-003 must be exercised against the real worker and object store, not only
# the pure formatter. A second job for the same baby is allowed after the first
# one completes and remains within the persisted hourly limit.
no_media_export_key="$(uuid)"
status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":false,"format":"zip"}' "$admin_token" "$no_media_export_key" \
  "$work_dir/export-no-media.json")"
assert_status "$status" 201 'No-media export creation'
no_media_export_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/export-no-media.json")"
jq --exit-status '
  .data.status == "pending" and
  .data.includeMedia == false and
  .data.downloadUrl == null
' "$work_dir/export-no-media.json" >/dev/null

(
  cd "$repo_root"
  pnpm --filter @baby-mp/api exec tsx src/exports/run-export-worker.ts --once \
    >"$work_dir/worker-no-media.json"
)
tail -n 1 "$work_dir/worker-no-media.json" \
  | jq --exit-status '.processed == true' >/dev/null

status="$(request GET "/exports/$no_media_export_id" '' \
  "$admin_token" '' "$work_dir/export-no-media-completed.json")"
assert_status "$status" 200 'Completed no-media export detail'
jq --exit-status '
  .data.status == "completed" and
  .data.includeMedia == false and
  .data.downloadUrl == null and
  (.data.expiresAt | type == "string")
' "$work_dir/export-no-media-completed.json" >/dev/null

status="$(request POST "/exports/$no_media_export_id/download-url" '{}' \
  "$admin_token" '' "$work_dir/download-url-no-media.json")"
assert_status "$status" 200 'No-media export download URL'
no_media_download_url="$(jq --exit-status --raw-output \
  '.data.downloadUrl' "$work_dir/download-url-no-media.json")"
curl --silent --show-error --fail "$no_media_download_url" \
  --output "$work_dir/export-no-media.zip"
unzip -t "$work_dir/export-no-media.zip" >/dev/null
unzip -Z1 "$work_dir/export-no-media.zip" >"$work_dir/export-no-media-entries.txt"
if grep -E '^media/' "$work_dir/export-no-media-entries.txt" >/dev/null; then
  echo 'includeMedia=false export contains a media archive entry' >&2
  exit 1
fi
unzip -q "$work_dir/export-no-media.zip" -d "$work_dir/archive-no-media"

jq --exit-status '
  .includeMedia == false and
  .counts.mediaReferences == 1 and
  .counts.includedMedia == 0 and
  (.files | index("json/export.json") != null) and
  (.files | index("csv/media.csv") != null) and
  ([.files[] | select(startswith("media/"))] | length == 0)
' "$work_dir/archive-no-media/manifest.json" >/dev/null
jq --exit-status \
  --arg baby "$baby_id" \
  --arg note "$note_id" \
  --arg media "$media_id" \
  '
    .baby.id == $baby and
    ([.records[].id] | index($note) != null) and
    ([.media[] | select(
      .id == $media and
      .recordId == $note and
      .use == "record" and
      .included == false and
      .archivePath == null
    )] | length == 1) and
    ([.records[] | select(.id == $note) | .media[] | select(
      .id == $media and .included == false and .archivePath == null
    )] | length == 1) and
    ([.. | objects | keys[]] | any(
      . == "objectKey" or
      . == "uploadObjectKey" or
      . == "bucket" or
      . == "accessUrl" or
      . == "downloadUrl"
    ) | not)
  ' "$work_dir/archive-no-media/json/export.json" >/dev/null
grep -F '"mediaId","recordId","use","sortOrder","mimeType","sizeBytes","width","height","included","archivePath"' \
  "$work_dir/archive-no-media/csv/media.csv" >/dev/null
grep -F "\"$media_id\",\"$note_id\",\"record\",\"0\",\"image/png\",\"$image_size\",\"2\",\"3\",\"false\",\"\"" \
  "$work_dir/archive-no-media/csv/media.csv" >/dev/null

source_object_key="$(
  db_query --tuples-only --no-align --quiet \
    --command="select object_key from media where id = '$media_id';" \
    | tr -d '[:space:]'
)"
if [[ -z "$source_object_key" ]]; then
  echo 'Source media object key was unavailable for no-media leak checks' >&2
  exit 1
fi
if grep -R -F "$source_object_key" "$work_dir/archive-no-media" >/dev/null; then
  echo 'includeMedia=false export leaked a private source object key' >&2
  exit 1
fi
if grep -R -E -i 'x-amz-|signature=|https?://' "$work_dir/archive-no-media" >/dev/null; then
  echo 'includeMedia=false export leaked a signed or storage URL' >&2
  exit 1
fi

anonymous_status="$(curl --silent --show-error \
  --output "$work_dir/anonymous.txt" --write-out '%{http_code}' \
  "$STORAGE_BASE_URL/$STORAGE_BUCKET")"
assert_status "$anonymous_status" 403 'Anonymous bucket listing'

read -r result_media_id object_key <<<"$(
  db_query --tuples-only --no-align --quiet \
    --field-separator=' ' \
    --command="select result_media_id, object_key from export_jobs join media on media.id = result_media_id where export_jobs.id = '$export_id';"
)"
read -r no_media_result_media_id no_media_object_key <<<"$(
  db_query --tuples-only --no-align --quiet \
    --field-separator=' ' \
    --command="select result_media_id, object_key from export_jobs join media on media.id = result_media_id where export_jobs.id = '$no_media_export_id';"
)"
status="$(request GET "/media/$result_media_id" '' \
  "$admin_token" '' "$work_dir/archive-media.json")"
assert_status "$status" 404 'Export archive generic-media isolation'
status="$(request GET "/media/$no_media_result_media_id" '' \
  "$admin_token" '' "$work_dir/archive-no-media-endpoint.json")"
assert_status "$status" 404 'No-media export archive generic-media isolation'

unsafe_audit_count="$(
  db_query --tuples-only --no-align --quiet \
    --command="select count(*) from audit_logs where resource_id in ('$export_id', '$no_media_export_id') and (metadata::text like '%$object_key%' or metadata::text like '%$no_media_object_key%' or metadata::text like '%X-Amz-%');" \
    | tr -d '[:space:]'
)"
[[ "$unsafe_audit_count" == 0 ]]

# Exercise cleanup of a worker-crash placeholder against the real PostgreSQL
# CHECK constraint. The row is intentionally unlinked and has no S3 object;
# DeleteObject remains idempotent and cleanup must tombstone and purge it.
orphan_media_id="$(uuid)"
orphan_object_key="exports/$orphan_media_id.zip"
admin_user_id="$(
  db_query --tuples-only --no-align --quiet \
    --command="select created_by from babies where id = '$baby_id';" \
    | tr -d '[:space:]'
)"
db_query --quiet \
    --command="insert into media (id, owner_user_id, baby_id, bucket, object_key, mime_type, size_bytes, status, purpose, created_at) values ('$orphan_media_id', '$admin_user_id', '$baby_id', '$STORAGE_BUCKET', '$orphan_object_key', 'application/zip', 0, 'pending', 'export_archive', now() - interval '40 minutes');" \
  >/dev/null

db_query --quiet \
  --command="update export_jobs set expires_at = now() - interval '1 minute' where id = '$export_id';" \
  >/dev/null
(
  cd "$repo_root"
  pnpm --filter @baby-mp/api exec tsx src/exports/run-export-worker.ts --cleanup \
    >"$work_dir/cleanup.json"
)
tail -n 1 "$work_dir/cleanup.json" | jq --exit-status '.cleaned == 2' >/dev/null
purged="$(
  db_query --tuples-only --no-align --quiet \
    --command="select (export_jobs.status = 'expired')::int || ':' || (media.purged_at is not null)::int from export_jobs join media on media.id = result_media_id where export_jobs.id = '$export_id';" \
    | tr -d '[:space:]'
)"
[[ "$purged" == '1:1' ]]
orphan_purged="$(
  db_query --tuples-only --no-align --quiet \
    --command="select (status = 'deleted')::int || ':' || (deleted_at is not null)::int || ':' || (purged_at is not null)::int from media where id = '$orphan_media_id';" \
    | tr -d '[:space:]'
)"
[[ "$orphan_purged" == '1:1:1' ]]
object_status="$(curl --silent --show-error \
  --output "$work_dir/purged-object.txt" --write-out '%{http_code}' \
  "$STORAGE_BASE_URL/$STORAGE_BUCKET/$object_key")"
assert_status "$object_status" 403 'Purged private object remains inaccessible'

echo "M6 real API verification passed: media-export=$export_id no-media-export=$no_media_export_id records=2 media-manifest=1 orphan-cleanup=1"
