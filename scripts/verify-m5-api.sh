#!/usr/bin/env bash
set -euo pipefail

umask 077

API_BASE_URL="${M5_API_BASE_URL:-http://127.0.0.1:3000/api/v1}"
: "${DATABASE_URL:?DATABASE_URL is required for M5 database safety assertions}"

for command in curl jq node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if command -v psql >/dev/null 2>&1; then
  db_query() {
    psql "$DATABASE_URL" --no-psqlrc "$@"
  }
elif command -v docker >/dev/null 2>&1 && [[ -n "${M5_PSQL_CONTAINER:-}" ]]; then
  db_query() {
    docker exec -i "$M5_PSQL_CONTAINER" psql \
      -U "${M5_POSTGRES_USER:-baby_mp}" \
      -d "${M5_POSTGRES_DB:-baby_mp}" \
      --no-psqlrc "$@"
  }
else
  echo 'Missing psql; alternatively set M5_PSQL_CONTAINER for a PostgreSQL container' >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-m5-verify.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

uuid() {
  node -e 'process.stdout.write(crypto.randomUUID())'
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

login() {
  local key="$1"
  local display_name="$2"
  curl --silent --show-error --fail \
    --request POST "$API_BASE_URL/auth/mock-login" \
    --header 'content-type: application/json' \
    --data "{\"mockUserKey\":\"$key\",\"displayName\":\"$display_name\"}" \
    | jq --exit-status --raw-output '.data.accessToken'
}

run_id="$(date +%s)-$(uuid)"
admin_token="$(login "m5-admin-$run_id" 'M5 admin')"
candidate_a_token="$(login "m5-candidate-a-$run_id" 'M5 candidate A')"
candidate_b_token="$(login "m5-candidate-b-$run_id" 'M5 candidate B')"

baby_id="$({
  curl --silent --show-error --fail \
    --request POST "$API_BASE_URL/babies" \
    --header "authorization: Bearer $admin_token" \
    --header "idempotency-key: $(uuid)" \
    --header 'content-type: application/json' \
    --data '{"name":"M5 verification baby","gender":"unspecified","birthDate":"2025-01-01"}'
} | jq --exit-status --raw-output '.data.id')"

second_baby_id="$({
  curl --silent --show-error --fail \
    --request POST "$API_BASE_URL/babies" \
    --header "authorization: Bearer $admin_token" \
    --header "idempotency-key: $(uuid)" \
    --header 'content-type: application/json' \
    --data '{"name":"M5 isolation baby","gender":"unspecified","birthDate":"2025-01-01"}'
} | jq --exit-status --raw-output '.data.id')"

invite_key="$(uuid)"
invite_first="$work_dir/invite-first.json"
invite_replay="$work_dir/invite-replay.json"
for output in "$invite_first" "$invite_replay"; do
  curl --silent --show-error --fail \
    --request POST "$API_BASE_URL/babies/$baby_id/invites" \
    --header "authorization: Bearer $admin_token" \
    --header "idempotency-key: $invite_key" \
    --header 'content-type: application/json' \
    --data '{"role":"editor","expiresInHours":24}' \
    --output "$output"
done

invite_id="$(jq --exit-status --raw-output '.data.id' "$invite_first")"
invite_token="$(jq --exit-status --raw-output '.data.token' "$invite_first")"
[[ "$invite_id" == "$(jq --exit-status --raw-output '.data.id' "$invite_replay")" ]]
[[ "$invite_token" == "$(jq --exit-status --raw-output '.data.token' "$invite_replay")" ]]
[[ "$invite_token" =~ ^[A-Za-z0-9_-]{43}$ ]]

preview_file="$work_dir/preview.json"
curl --silent --show-error --fail \
  --request POST "$API_BASE_URL/invites/preview" \
  --header 'content-type: application/json' \
  --data "{\"token\":\"$invite_token\"}" \
  --output "$preview_file"
jq --exit-status '
  .data.status == "pending" and
  .data.role == "editor" and
  (.data | has("records") | not) and
  (.data | has("members") | not)
' "$preview_file" >/dev/null

curl --silent --show-error \
  --request POST "$API_BASE_URL/invites/accept" \
  --header "authorization: Bearer $candidate_a_token" \
  --header "idempotency-key: $(uuid)" \
  --header 'content-type: application/json' \
  --data "{\"token\":\"$invite_token\"}" \
  --output "$work_dir/accept-a.json" \
  --write-out '%{http_code}' >"$work_dir/accept-a.code" &
accept_a_pid=$!
curl --silent --show-error \
  --request POST "$API_BASE_URL/invites/accept" \
  --header "authorization: Bearer $candidate_b_token" \
  --header "idempotency-key: $(uuid)" \
  --header 'content-type: application/json' \
  --data "{\"token\":\"$invite_token\"}" \
  --output "$work_dir/accept-b.json" \
  --write-out '%{http_code}' >"$work_dir/accept-b.code" &
accept_b_pid=$!
wait "$accept_a_pid"
wait "$accept_b_pid"

accept_a_status="$(<"$work_dir/accept-a.code")"
accept_b_status="$(<"$work_dir/accept-b.code")"
if [[ "$accept_a_status" == 200 && "$accept_b_status" == 409 ]]; then
  member_token="$candidate_a_token"
  outsider_token="$candidate_b_token"
  rejected_accept="$work_dir/accept-b.json"
elif [[ "$accept_b_status" == 200 && "$accept_a_status" == 409 ]]; then
  member_token="$candidate_b_token"
  outsider_token="$candidate_a_token"
  rejected_accept="$work_dir/accept-a.json"
else
  echo "Concurrent invite acceptance did not produce exactly one 200 and one 409" >&2
  exit 1
fi
jq --exit-status '.error.code == "INVITE_ALREADY_USED"' "$rejected_accept" >/dev/null

members_file="$work_dir/members.json"
curl --silent --show-error --fail \
  "$API_BASE_URL/babies/$baby_id/members" \
  --header "authorization: Bearer $admin_token" \
  --output "$members_file"
member_id="$(jq --exit-status --raw-output '.data[] | select(.role == "editor") | .id' "$members_file")"
member_version="$(jq --exit-status --raw-output --arg id "$member_id" '.data[] | select(.id == $id) | .version' "$members_file")"
admin_member_id="$(jq --exit-status --raw-output '.data[] | select(.isCurrentUser == true) | .id' "$members_file")"

role_viewer_file="$work_dir/role-viewer.json"
curl --silent --show-error --fail \
  --request PATCH "$API_BASE_URL/babies/$baby_id/members/$member_id" \
  --header "authorization: Bearer $admin_token" \
  --header 'content-type: application/json' \
  --data "{\"version\":$member_version,\"role\":\"viewer\"}" \
  --output "$role_viewer_file"

viewer_write_status="$(curl --silent --show-error \
  --request POST "$API_BASE_URL/babies/$baby_id/records" \
  --header "authorization: Bearer $member_token" \
  --header "idempotency-key: $(uuid)" \
  --header 'content-type: application/json' \
  --data '{"type":"note","occurredAt":"2026-07-17T00:00:00.000Z","content":"M5 ACL probe","mediaIds":[]}' \
  --output "$work_dir/viewer-write.json" \
  --write-out '%{http_code}')"
assert_status "$viewer_write_status" 403 'Viewer real-time write denial'

member_version="$(jq --exit-status --raw-output '.data.version' "$role_viewer_file")"
role_admin_file="$work_dir/role-admin.json"
curl --silent --show-error --fail \
  --request PATCH "$API_BASE_URL/babies/$baby_id/members/$member_id" \
  --header "authorization: Bearer $admin_token" \
  --header 'content-type: application/json' \
  --data "{\"version\":$member_version,\"role\":\"admin\"}" \
  --output "$role_admin_file"

curl --silent --show-error --fail \
  "$API_BASE_URL/babies/$baby_id/members" \
  --header "authorization: Bearer $admin_token" \
  --output "$members_file"
admin_version="$(jq --exit-status --raw-output --arg id "$admin_member_id" '.data[] | select(.id == $id) | .version' "$members_file")"
admin_demotion_file="$work_dir/admin-demotion.json"
curl --silent --show-error --fail \
  --request PATCH "$API_BASE_URL/babies/$baby_id/members/$admin_member_id" \
  --header "authorization: Bearer $admin_token" \
  --header 'content-type: application/json' \
  --data "{\"version\":$admin_version,\"role\":\"viewer\"}" \
  --output "$admin_demotion_file"

curl --silent --show-error --fail \
  "$API_BASE_URL/babies/$baby_id/members" \
  --header "authorization: Bearer $member_token" \
  --output "$members_file"
member_version="$(jq --exit-status --raw-output --arg id "$member_id" '.data[] | select(.id == $id) | .version' "$members_file")"
last_admin_status="$(curl --silent --show-error \
  --request PATCH "$API_BASE_URL/babies/$baby_id/members/$member_id" \
  --header "authorization: Bearer $member_token" \
  --header 'content-type: application/json' \
  --data "{\"version\":$member_version,\"role\":\"viewer\"}" \
  --output "$work_dir/last-admin.json" \
  --write-out '%{http_code}')"
assert_status "$last_admin_status" 409 'Last-admin protection'
jq --exit-status '.error.code == "LAST_ADMIN_REQUIRED"' "$work_dir/last-admin.json" >/dev/null

admin_version="$(jq --exit-status --raw-output '.data.version' "$admin_demotion_file")"
curl --silent --show-error --fail \
  --request PATCH "$API_BASE_URL/babies/$baby_id/members/$admin_member_id" \
  --header "authorization: Bearer $member_token" \
  --header 'content-type: application/json' \
  --data "{\"version\":$admin_version,\"role\":\"admin\"}" \
  --output "$work_dir/admin-restored.json"

cross_member_status="$(curl --silent --show-error \
  --request PATCH "$API_BASE_URL/babies/$second_baby_id/members/$member_id" \
  --header "authorization: Bearer $admin_token" \
  --header 'content-type: application/json' \
  --data "{\"version\":$member_version,\"role\":\"viewer\"}" \
  --output "$work_dir/cross-member.json" \
  --write-out '%{http_code}')"
assert_status "$cross_member_status" 404 'Cross-baby member isolation'

outsider_status="$(curl --silent --show-error \
  "$API_BASE_URL/babies/$baby_id/members" \
  --header "authorization: Bearer $outsider_token" \
  --output "$work_dir/outsider.json" \
  --write-out '%{http_code}')"
assert_status "$outsider_status" 404 'Outsider isolation'

curl --silent --show-error --fail \
  "$API_BASE_URL/babies/$baby_id/members" \
  --header "authorization: Bearer $admin_token" \
  --output "$members_file"
member_version="$(jq --exit-status --raw-output --arg id "$member_id" '.data[] | select(.id == $id) | .version' "$members_file")"
curl --silent --show-error --fail \
  --request DELETE "$API_BASE_URL/babies/$baby_id/members/$member_id?version=$member_version" \
  --header "authorization: Bearer $admin_token" \
  --output /dev/null

removed_status="$(curl --silent --show-error \
  "$API_BASE_URL/babies/$baby_id" \
  --header "authorization: Bearer $member_token" \
  --output "$work_dir/removed.json" \
  --write-out '%{http_code}')"
assert_status "$removed_status" 404 'Removed-member token invalidation'

token_hash="$(
  printf '%s' "$invite_token" | node -e '
    const { createHash } = require("node:crypto");
    const hash = createHash("sha256");
    process.stdin.on("data", (chunk) => hash.update(chunk))
      .on("end", () => process.stdout.write(hash.digest("hex")));
  '
)"
database_assertions="$({
  db_query --tuples-only --no-align --quiet \
    --set ON_ERROR_STOP=1 \
    --set baby_id="$baby_id" \
    --set invite_id="$invite_id" \
    --set token_hash="$token_hash" <<'SQL'
SELECT concat_ws('|',
  (SELECT count(*) FROM family_invites
    WHERE id = :'invite_id'::uuid AND baby_id = :'baby_id'::uuid AND token_hash = :'token_hash'),
  (SELECT count(*) FROM family_invites WHERE token_hash !~ '^[0-9a-f]{64}$'),
  (SELECT count(*) FROM idempotency_keys
    WHERE operation LIKE 'families.%' AND response_body ? 'token'),
  (SELECT count(*) FROM audit_logs
    WHERE baby_id = :'baby_id'::uuid AND action = 'family.invite.created'),
  (SELECT count(*) FROM audit_logs
    WHERE baby_id = :'baby_id'::uuid AND action = 'family.invite.accepted'),
  (SELECT count(*) FROM audit_logs
    WHERE baby_id = :'baby_id'::uuid AND action = 'family.member.role_changed'),
  (SELECT count(*) FROM audit_logs
    WHERE baby_id = :'baby_id'::uuid AND action = 'family.member.removed'),
  (SELECT count(*) FROM audit_logs
    WHERE baby_id = :'baby_id'::uuid AND metadata::text ~ '[A-Za-z0-9_-]{43}')
);
SQL
} | tr -d '[:space:]')"

IFS='|' read -r matching_hash bad_hashes raw_response_tokens invite_created_audits \
  invite_accepted_audits role_changed_audits member_removed_audits unsafe_audit_metadata \
  <<<"$database_assertions"
[[ "$matching_hash" == 1 ]]
[[ "$bad_hashes" == 0 ]]
[[ "$raw_response_tokens" == 0 ]]
[[ "$invite_created_audits" -ge 1 ]]
[[ "$invite_accepted_audits" -ge 1 ]]
[[ "$role_changed_audits" -ge 1 ]]
[[ "$member_removed_audits" -ge 1 ]]
[[ "$unsafe_audit_metadata" == 0 ]]

unset invite_token admin_token candidate_a_token candidate_b_token member_token outsider_token
echo 'M5 API verification passed: invitation, ACL, isolation, last-admin, removal, hash-only storage, and audit safety.'
