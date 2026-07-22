#!/usr/bin/env bash
set -euo pipefail

umask 077

API_BASE_URL="${M7_API_BASE_URL:-http://127.0.0.1:3300/api/v1}"
: "${DATABASE_URL:?DATABASE_URL is required for M7 database assertions}"

for command in curl jq node pnpm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if command -v psql >/dev/null 2>&1; then
  db_query() {
    psql "$DATABASE_URL" --no-psqlrc "$@"
  }
elif command -v docker >/dev/null 2>&1 && [[ -n "${M7_PSQL_CONTAINER:-${M6_PSQL_CONTAINER:-}}" ]]; then
  db_query() {
    docker exec -i "${M7_PSQL_CONTAINER:-$M6_PSQL_CONTAINER}" psql \
      -U "${M7_POSTGRES_USER:-${M6_POSTGRES_USER:-baby_mp}}" \
      -d "${M7_POSTGRES_DB:-${M6_POSTGRES_DB:-baby_mp}}" \
      --no-psqlrc "$@"
  }
else
  echo 'Missing psql; alternatively set M7_PSQL_CONTAINER for a PostgreSQL container' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-m7-verify.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

uuid() {
  node -e 'process.stdout.write(crypto.randomUUID())'
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

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label failed: expected HTTP $expected, got $actual" >&2
    exit 1
  fi
}

assert_db_scalar() {
  local expected="$1"
  local query="$2"
  local label="$3"
  local actual
  actual="$(db_query -Atqc "$query")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label failed: expected $expected, got $actual" >&2
    exit 1
  fi
}

transition_data_rights_request() {
  local request_id="$1"
  local target_status="$2"
  local label="$3"
  local output="$work_dir/data-rights-transition-$target_status-$request_id.log"

  if ! (
    cd "$repo_root"
    DATA_RIGHTS_REQUEST_ID="$request_id" \
      DATA_RIGHTS_TARGET_STATUS="$target_status" \
      DATA_RIGHTS_OPERATOR_CONFIRM="$request_id:$target_status" \
      pnpm --silent --filter @baby-mp/api data-rights:transition
  ) >"$output" 2>&1; then
    echo "$label failed" >&2
    exit 1
  fi
  if ! grep -F "Data-rights request status updated to $target_status." "$output" >/dev/null; then
    echo "$label returned an unexpected result" >&2
    exit 1
  fi
}

login() {
  local key="$1"
  local output="$work_dir/login-$key.json"
  local status
  status="$(request POST /auth/mock-login \
    "{\"mockUserKey\":\"m7-$key\",\"displayName\":\"M7 synthetic user\"}" \
    '' '' "$output")"
  assert_status "$status" 201 "Mock login ($key)"
  jq --exit-status --raw-output '.data.accessToken' "$output"
}

run_id="$(date +%s)-$(uuid)"
admin_token="$(login "admin-$run_id")"
member_token="$(login "member-$run_id")"
outsider_token="$(login "outsider-$run_id")"
delete_member_token="$outsider_token"

status="$(request POST /babies \
  '{"name":"M7 synthetic baby","gender":"unspecified","birthDate":"2025-01-01"}' \
  "$admin_token" "$(uuid)" "$work_dir/baby.json")"
assert_status "$status" 201 'Baby creation'
baby_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/baby.json")"

# Create and accept an editor invitation so self-leave can be exercised with a
# token that remains cryptographically valid after membership removal.
status="$(request POST "/babies/$baby_id/invites" \
  '{"role":"editor","expiresInHours":24}' "$admin_token" "$(uuid)" "$work_dir/invite.json")"
assert_status "$status" 201 'Editor invitation'
invite_token="$(jq --exit-status --raw-output '.data.token' "$work_dir/invite.json")"
status="$(request POST /invites/accept "{\"token\":\"$invite_token\"}" \
  "$member_token" "$(uuid)" "$work_dir/accept.json")"
assert_status "$status" 200 'Editor invitation acceptance'

# Upload a real decoded image, promote it to the private ready object and bind
# it as the baby avatar. The Baby response must expose only a short signed URL.
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAADZSiLoAAAAGUlEQVR4nGP4z8DAwMDAxMDAwMDAwMAAAAwAAf8CBY0AAAAASUVORK5CYII=' \
  | base64 -d >"$work_dir/avatar.png"
avatar_size="$(wc -c <"$work_dir/avatar.png" | tr -d '[:space:]')"
status="$(request POST "/babies/$baby_id/media/uploads" \
  "{\"fileName\":\"avatar.png\",\"mimeType\":\"image/png\",\"sizeBytes\":$avatar_size}" \
  "$admin_token" '' "$work_dir/upload.json")"
assert_status "$status" 201 'Avatar upload authorization'
media_id="$(jq --exit-status --raw-output '.data.mediaId' "$work_dir/upload.json")"
upload_url="$(jq --exit-status --raw-output '.data.upload.url' "$work_dir/upload.json")"
put_status="$(curl --silent --show-error --output "$work_dir/put.txt" --write-out '%{http_code}' \
  --request PUT --header 'content-type: image/png' \
  --data-binary "@$work_dir/avatar.png" "$upload_url")"
assert_status "$put_status" 200 'Avatar signed PUT'
status="$(request POST "/media/$media_id/complete" '{"width":2,"height":3}' \
  "$admin_token" '' "$work_dir/complete.json")"
assert_status "$status" 200 'Avatar completion'
status="$(request PATCH "/babies/$baby_id" \
  "{\"version\":1,\"avatarMediaId\":\"$media_id\"}" \
  "$admin_token" '' "$work_dir/avatar-baby.json")"
assert_status "$status" 200 'Avatar association'
jq --exit-status '
  .data.version == 2 and
  (.data.avatarUrl | type == "string") and
  (.data.avatarUrl | startswith("http"))
' "$work_dir/avatar-baby.json" >/dev/null

status="$(request GET "/babies/$baby_id" '' "$outsider_token" '' "$work_dir/avatar-outsider.json")"
assert_status "$status" 404 'Outsider avatar isolation'

# Data-rights requests are durable, scoped, deduplicated, private and
# cancellable while pending. Submission never disables an account immediately.
scoped_body="{\"type\":\"data_access\",\"babyId\":\"$baby_id\"}"
status="$(request POST /me/data-rights-requests "$scoped_body" \
  "$member_token" '' "$work_dir/data-request.json")"
assert_status "$status" 201 'Scoped data-rights request'
data_request_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/data-request.json")"
status="$(request POST /me/data-rights-requests "$scoped_body" \
  "$member_token" '' "$work_dir/data-request-replay.json")"
assert_status "$status" 201 'Data-rights active request replay'
[[ "$data_request_id" == "$(jq --exit-status --raw-output '.data.id' "$work_dir/data-request-replay.json")" ]]

status="$(request GET /me/data-rights-requests '' "$member_token" '' "$work_dir/data-list.json")"
assert_status "$status" 200 'Data-rights request list'
jq --exit-status ".data | any(.id == \"$data_request_id\" and .status == \"pending\")" \
  "$work_dir/data-list.json" >/dev/null
status="$(request DELETE "/me/data-rights-requests/$data_request_id" '' \
  "$outsider_token" '' "$work_dir/data-cancel-outsider.json")"
assert_status "$status" 404 'Cross-user data-rights cancellation'
status="$(request DELETE "/me/data-rights-requests/$data_request_id" '' \
  "$member_token" '' "$work_dir/data-cancel.json")"
assert_status "$status" 204 'Data-rights cancellation'

status="$(request POST /me/data-rights-requests \
  "{\"type\":\"account_deletion\",\"babyId\":\"$baby_id\"}" \
  "$member_token" '' "$work_dir/account-invalid.json")"
assert_status "$status" 400 'Account deletion baby scope rejection'
status="$(request POST /me/data-rights-requests '{"type":"account_deletion"}' \
  "$member_token" '' "$work_dir/account-request.json")"
assert_status "$status" 201 'Account deletion request recording'
jq --exit-status '.data.status == "pending" and .data.babyId == null' \
  "$work_dir/account-request.json" >/dev/null
completed_request_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/account-request.json")"
assert_db_scalar 'pending|set|null' "
  SELECT status::text || '|' ||
    CASE WHEN active_request_key IS NULL THEN 'null' ELSE 'set' END || '|' ||
    CASE WHEN resolved_at IS NULL THEN 'null' ELSE 'set' END
  FROM data_rights_requests
  WHERE id = '$completed_request_id';
" 'Pending data-rights lifecycle state'

# Exercise the actual controlled operator entry point. Processing keeps the
# active key and has no resolution timestamp; the terminal state does the
# inverse and remains visible through the requester's public list API.
transition_data_rights_request \
  "$completed_request_id" processing 'Data-rights transition to processing'
status="$(request GET /me/data-rights-requests '' \
  "$member_token" '' "$work_dir/data-list-processing.json")"
assert_status "$status" 200 'Processing data-rights request list'
jq --exit-status --arg id "$completed_request_id" '
  .data | any(.id == $id and .status == "processing" and .resolvedAt == null)
' "$work_dir/data-list-processing.json" >/dev/null
assert_db_scalar 'processing|set|null' "
  SELECT status::text || '|' ||
    CASE WHEN active_request_key IS NULL THEN 'null' ELSE 'set' END || '|' ||
    CASE WHEN resolved_at IS NULL THEN 'null' ELSE 'set' END
  FROM data_rights_requests
  WHERE id = '$completed_request_id';
" 'Processing data-rights lifecycle state'
status="$(request DELETE "/me/data-rights-requests/$completed_request_id" '' \
  "$member_token" '' "$work_dir/data-cancel-processing.json")"
assert_status "$status" 409 'Processing data-rights cancellation rejection'
jq --exit-status '.error.code == "CONFLICT"' \
  "$work_dir/data-cancel-processing.json" >/dev/null

transition_data_rights_request \
  "$completed_request_id" completed 'Data-rights transition to completed'
status="$(request GET /me/data-rights-requests '' \
  "$member_token" '' "$work_dir/data-list-completed.json")"
assert_status "$status" 200 'Completed data-rights request list'
jq --exit-status --arg id "$completed_request_id" '
  .data | any(
    .id == $id and .status == "completed" and
    (.resolvedAt | type == "string")
  )
' "$work_dir/data-list-completed.json" >/dev/null
assert_db_scalar 'completed|null|set' "
  SELECT status::text || '|' ||
    CASE WHEN active_request_key IS NULL THEN 'null' ELSE 'set' END || '|' ||
    CASE WHEN resolved_at IS NULL THEN 'null' ELSE 'set' END
  FROM data_rights_requests
  WHERE id = '$completed_request_id';
" 'Completed data-rights lifecycle state'

status="$(request POST /me/data-rights-requests '{"type":"data_access"}' \
  "$member_token" '' "$work_dir/rejected-request.json")"
assert_status "$status" 201 'Rejected-path data-rights request recording'
rejected_request_id="$(jq --exit-status --raw-output '.data.id' "$work_dir/rejected-request.json")"
jq --exit-status '.data.status == "pending" and .data.resolvedAt == null' \
  "$work_dir/rejected-request.json" >/dev/null
transition_data_rights_request \
  "$rejected_request_id" processing 'Rejected-path transition to processing'
transition_data_rights_request \
  "$rejected_request_id" rejected 'Data-rights transition to rejected'
status="$(request GET /me/data-rights-requests '' \
  "$member_token" '' "$work_dir/data-list-rejected.json")"
assert_status "$status" 200 'Rejected data-rights request list'
jq --exit-status --arg id "$rejected_request_id" '
  .data | any(
    .id == $id and .status == "rejected" and
    (.resolvedAt | type == "string")
  )
' "$work_dir/data-list-rejected.json" >/dev/null
assert_db_scalar 'rejected|null|set' "
  SELECT status::text || '|' ||
    CASE WHEN active_request_key IS NULL THEN 'null' ELSE 'set' END || '|' ||
    CASE WHEN resolved_at IS NULL THEN 'null' ELSE 'set' END
  FROM data_rights_requests
  WHERE id = '$rejected_request_id';
" 'Rejected data-rights lifecycle state'
assert_db_scalar '4' "
  SELECT count(*)
  FROM audit_logs
  WHERE action = 'data_rights.request.status_changed'
    AND resource_type = 'data_rights_request'
    AND actor_user_id IS NULL
    AND request_id IS NOT NULL
    AND (
      (
        resource_id = '$completed_request_id'
        AND metadata IN (
          jsonb_build_object('from', 'pending', 'to', 'processing'),
          jsonb_build_object('from', 'processing', 'to', 'completed')
        )
      )
      OR
      (
        resource_id = '$rejected_request_id'
        AND metadata IN (
          jsonb_build_object('from', 'pending', 'to', 'processing'),
          jsonb_build_object('from', 'processing', 'to', 'rejected')
        )
      )
    );
" 'Low-sensitivity data-rights transition audits'

active_scoped_body="{\"type\":\"correction\",\"babyId\":\"$baby_id\"}"
status="$(request POST /me/data-rights-requests "$active_scoped_body" \
  "$member_token" '' "$work_dir/active-scoped-request.json")"
assert_status "$status" 201 'Active scoped request before self-leave'

status="$(request GET "/babies/$baby_id/members" '' "$admin_token" '' "$work_dir/members.json")"
assert_status "$status" 200 'Member list before self-leave'
admin_version="$(jq --exit-status --raw-output '.data[] | select(.isCurrentUser) | .version' "$work_dir/members.json")"
member_version="$(jq --exit-status --raw-output '.data[] | select(.role == "editor") | .version' "$work_dir/members.json")"
status="$(request DELETE "/babies/$baby_id/membership?version=$admin_version" '' \
  "$admin_token" '' "$work_dir/admin-leave.json")"
assert_status "$status" 409 'Last administrator self-leave protection'
status="$(request DELETE "/babies/$baby_id/membership?version=$member_version" '' \
  "$member_token" '' "$work_dir/member-leave.json")"
assert_status "$status" 204 'Editor self-leave'
status="$(request GET "/babies/$baby_id" '' "$member_token" '' "$work_dir/member-after-leave.json")"
assert_status "$status" 404 'Immediate access loss after self-leave'
status="$(request POST /me/data-rights-requests "$scoped_body" \
  "$member_token" '' "$work_dir/scoped-after-leave.json")"
assert_status "$status" 404 'Removed member data-rights scope isolation'
status="$(request POST /me/data-rights-requests "$active_scoped_body" \
  "$member_token" '' "$work_dir/active-scoped-after-leave.json")"
assert_status "$status" 404 'Removed member active request replay isolation'

# Keep a second member active, a separate invitation pending, and a real export
# pending when deletion begins. This turns the deletion assertions into an
# end-to-end check of every atomic revocation branch rather than an empty-state
# check that would also pass if the updates were missing.
status="$(request DELETE "/babies/$baby_id" '' \
  "$outsider_token" '' "$work_dir/delete-outsider.json")"
assert_status "$status" 404 'Outsider baby deletion'
status="$(request POST "/babies/$baby_id/invites" \
  '{"role":"viewer","expiresInHours":24}' \
  "$admin_token" "$(uuid)" "$work_dir/delete-member-invite.json")"
assert_status "$status" 201 'Deletion-scope member invitation'
delete_member_invite_token="$(jq --exit-status --raw-output \
  '.data.token' "$work_dir/delete-member-invite.json")"
status="$(request POST /invites/accept \
  "{\"token\":\"$delete_member_invite_token\"}" \
  "$delete_member_token" "$(uuid)" "$work_dir/delete-member-accept.json")"
assert_status "$status" 200 'Deletion-scope member invitation acceptance'
status="$(request GET "/babies/$baby_id" '' \
  "$delete_member_token" '' "$work_dir/delete-member-before-delete.json")"
assert_status "$status" 200 'Deletion-scope member access before deletion'

status="$(request POST "/babies/$baby_id/invites" \
  '{"role":"viewer","expiresInHours":24}' \
  "$admin_token" "$(uuid)" "$work_dir/pending-delete-invite.json")"
assert_status "$status" 201 'Pending invitation before baby deletion'
pending_invite_id="$(jq --exit-status --raw-output \
  '.data.id' "$work_dir/pending-delete-invite.json")"
pending_invite_token="$(jq --exit-status --raw-output \
  '.data.token' "$work_dir/pending-delete-invite.json")"
jq --exit-status '.data.status == "pending"' \
  "$work_dir/pending-delete-invite.json" >/dev/null

status="$(request POST "/babies/$baby_id/exports" \
  '{"includeMedia":false,"format":"zip"}' \
  "$admin_token" "$(uuid)" "$work_dir/active-delete-export.json")"
assert_status "$status" 201 'Active export before baby deletion'
active_export_id="$(jq --exit-status --raw-output \
  '.data.id' "$work_dir/active-delete-export.json")"
jq --exit-status '.data.status == "pending" and .data.downloadUrl == null' \
  "$work_dir/active-delete-export.json" >/dev/null
assert_db_scalar '2|pending|pending' "
  SELECT
    (SELECT count(*) FROM baby_members
      WHERE baby_id = '$baby_id' AND status = 'active')::text || '|' ||
    (SELECT status::text FROM family_invites WHERE id = '$pending_invite_id') || '|' ||
    (SELECT status::text FROM export_jobs WHERE id = '$active_export_id');
" 'Pre-deletion active resources'

status="$(request DELETE "/babies/$baby_id" '' "$admin_token" '' "$work_dir/delete-baby.json")"
assert_status "$status" 204 'Baby soft deletion'
status="$(request GET "/babies/$baby_id" '' "$admin_token" '' "$work_dir/deleted-baby.json")"
assert_status "$status" 404 'Deleted baby immediate access loss'
status="$(request GET "/babies/$baby_id" '' \
  "$delete_member_token" '' "$work_dir/delete-member-after-delete.json")"
assert_status "$status" 404 'All-member immediate access loss after baby deletion'
status="$(request GET "/exports/$active_export_id" '' \
  "$admin_token" '' "$work_dir/deleted-export-api.json")"
assert_status "$status" 404 'Deleted-baby export access loss'
jq --exit-status '.error.code == "RESOURCE_NOT_FOUND"' \
  "$work_dir/deleted-export-api.json" >/dev/null
status="$(request POST /invites/accept \
  "{\"token\":\"$pending_invite_token\"}" \
  "$outsider_token" "$(uuid)" "$work_dir/revoked-invite-accept.json")"
assert_status "$status" 409 'Deleted-baby invitation rejection'
jq --exit-status '.error.code == "INVITE_REVOKED"' \
  "$work_dir/revoked-invite-accept.json" >/dev/null

database_evidence="$(db_query -Atqc "
  SELECT
    (SELECT count(*) FROM babies WHERE id = '$baby_id' AND deleted_at IS NOT NULL),
    (SELECT count(*) FROM baby_members WHERE baby_id = '$baby_id' AND status = 'active'),
    (SELECT count(*) FROM data_rights_requests
      WHERE id = '$data_request_id' AND status = 'cancelled'
        AND active_request_key IS NULL AND resolved_at IS NOT NULL),
    (SELECT count(*) FROM family_invites
      WHERE id = '$pending_invite_id' AND status = 'revoked' AND revoked_at IS NOT NULL),
    (SELECT count(*) FROM export_jobs
      WHERE id = '$active_export_id' AND status = 'failed'
        AND error_code = 'BABY_DELETED'
        AND worker_lease_id IS NULL AND lease_expires_at IS NULL),
    (SELECT count(*) FROM baby_members
      WHERE baby_id = '$baby_id' AND status = 'removed'
        AND removed_at IS NOT NULL),
    (SELECT count(*) FROM audit_logs
      WHERE baby_id = '$baby_id' AND action = 'family.member.left'),
    (SELECT count(*) FROM audit_logs
      WHERE baby_id = '$baby_id'
        AND action = 'baby.deleted'
        AND actor_user_id = (
          SELECT created_by FROM babies WHERE id = '$baby_id'
        )
        AND resource_type = 'baby'
        AND resource_id = '$baby_id'
        AND request_id IS NOT NULL
        AND metadata = '{}'::jsonb);
")"
if [[ "$database_evidence" != '1|0|1|1|1|3|1|1' ]]; then
  echo "M7 database assertions failed: $database_evidence" >&2
  exit 1
fi

echo 'M7 real API verification passed: controlled privacy lifecycle, immediate revocation, and low-sensitivity audit evidence are complete.'
