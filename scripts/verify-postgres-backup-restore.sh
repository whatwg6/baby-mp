#!/usr/bin/env bash
set -euo pipefail

umask 077

validate_sensitive_file() {
  local path="$1"
  local label="$2"
  local mode
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "$label must be a regular file, not a symbolic link" >&2
    return 1
  fi
  if mode="$(stat -c '%a' -- "$path" 2>/dev/null)"; then
    :
  elif mode="$(stat -f '%Lp' "$path" 2>/dev/null)"; then
    :
  else
    echo "Unable to verify $label permissions; operation refused" >&2
    return 1
  fi
  if [[ ! "$mode" =~ ^[0-7]{3,4}$ ]] || (( (8#$mode & 8#7177) != 0 )); then
    echo "$label permissions must not be broader than 0600 (found $mode)" >&2
    return 1
  fi
}

for command in createdb curl dropdb node pnpm psql; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
if [[ -z "${PGPASSWORD:-}" && -z "${PGPASSFILE:-}" ]]; then
  echo "Supply PGPASSWORD or PGPASSFILE through the environment" >&2
  exit 1
fi
if [[ -n "${PGPASSFILE:-}" ]]; then
  validate_sensitive_file "$PGPASSFILE" PGPASSFILE
fi

app_env="${APP_ENV:-local}"
case "$app_env" in
  local|test|staging|production) ;;
  *)
    echo "APP_ENV must be local, test, staging, or production" >&2
    exit 1
    ;;
esac
if [[ "$app_env" == "production" ]]; then
  echo "The automated rehearsal must never run against production" >&2
  exit 1
fi
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  : "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required for an encrypted rehearsal}"
  validate_sensitive_file "$AGE_IDENTITY_FILE" AGE_IDENTITY_FILE
fi
if [[ "${REHEARSAL_CONFIRM:-}" != "CREATE_AND_DROP_DISPOSABLE_DATABASE" ]]; then
  echo "Set REHEARSAL_CONFIRM=CREATE_AND_DROP_DISPOSABLE_DATABASE to run the rehearsal" >&2
  exit 1
fi
if [[ "${REHEARSAL_SOURCE_QUIESCED:-}" != "YES" ]]; then
  echo "Pause source writes, then set REHEARSAL_SOURCE_QUIESCED=YES" >&2
  exit 1
fi

source_database="$PGDATABASE"
maintenance_database="${PGMAINTENANCE_DB:-postgres}"
target_database="baby_mp_restore_rehearsal_$(date -u +%Y%m%d%H%M%S)_$$"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-restore-rehearsal.XXXXXX")"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
runtime_layout="${RESTORE_RUNTIME_LAYOUT:-workspace}"
case "$runtime_layout" in
  workspace)
    api_entrypoint="$repo_root/apps/api/dist/main.js"
    api_workdir="$repo_root/apps/api"
    deploy_command=(pnpm db:deploy)
    ;;
  runtime)
    api_entrypoint="$repo_root/dist/main.js"
    api_workdir="$repo_root"
    deploy_command=(pnpm run prisma:deploy)
    ;;
  *)
    echo 'RESTORE_RUNTIME_LAYOUT must be workspace or runtime' >&2
    exit 1
    ;;
esac
target_created=false
api_pid=''

cleanup() {
  local original_status=$?
  local cleanup_failed=false
  set +e
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null
    wait "$api_pid" 2>/dev/null
  fi
  if [[ "$target_created" == "true" ]]; then
    if ! dropdb --maintenance-db "$maintenance_database" --if-exists "$target_database" >/dev/null 2>&1; then
      echo "Failed to remove disposable restore database: $target_database" >&2
      cleanup_failed=true
    fi
  fi
  rm -rf -- "$work_dir"
  if [[ "$original_status" -ne 0 ]]; then
    return "$original_status"
  fi
  if [[ "$cleanup_failed" == "true" ]]; then
    return 1
  fi
  return 0
}
trap cleanup EXIT

table_counts() {
  local count_sql
  count_sql="$(
    psql --no-psqlrc --tuples-only --no-align --command \
      "SELECT string_agg(
         format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
         ' UNION ALL '
         ORDER BY schemaname, tablename
       )
       FROM pg_catalog.pg_tables
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
  )"
  if [[ -z "$count_sql" ]]; then
    echo "Source database has no application tables" >&2
    exit 1
  fi
  psql --no-psqlrc --tuples-only --no-align --field-separator '|' --command "$count_sql"
}

export BACKUP_DIR="$work_dir"
backup_path="$(PGDATABASE="$source_database" "$script_dir/postgres-backup.sh")"
PGDATABASE="$source_database" table_counts >"$work_dir/source-counts.txt"

createdb --maintenance-db "$maintenance_database" "$target_database"
target_created=true
export PGDATABASE="$target_database"
export RESTORE_CONFIRM="${PGHOST}:${PGPORT}/${target_database}"
"$script_dir/postgres-restore.sh" "$backup_path"
table_counts >"$work_dir/restored-counts.txt"

if ! diff -u "$work_dir/source-counts.txt" "$work_dir/restored-counts.txt"; then
  echo "Restored exact per-table row counts differ from the source" >&2
  exit 1
fi

invalid_media_references="$(
  psql --no-psqlrc --tuples-only --no-align --command \
    "SELECT count(*)
       FROM media
      WHERE status = 'ready'
        AND purged_at IS NULL
        AND (bucket = '' OR object_key = '');"
)"
if [[ "$invalid_media_references" != "0" ]]; then
  echo "Restored database contains incomplete ready-media references" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required to deploy migrations and smoke-test the restored database" >&2
  exit 1
fi
if [[ ! -f "$api_entrypoint" ]]; then
  echo "Build the API before the restore rehearsal; $api_entrypoint is missing" >&2
  exit 1
fi

restore_database_url="$(
  SOURCE_DATABASE="$source_database" TARGET_DATABASE="$target_database" node -e '
    const value = process.env.DATABASE_URL;
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) process.exit(1);
    const source = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (source !== process.env.SOURCE_DATABASE) process.exit(1);
    url.pathname = `/${encodeURIComponent(process.env.TARGET_DATABASE)}`;
    process.stdout.write(url.toString());
  '
)" || {
  echo "DATABASE_URL must be a PostgreSQL URL for the configured source database" >&2
  exit 1
}

(
  cd "$repo_root"
  DATABASE_URL="$restore_database_url" "${deploy_command[@]}" >/dev/null
)

smoke_port="${RESTORE_SMOKE_API_PORT:-3499}"
if [[ ! "$smoke_port" =~ ^[0-9]+$ ]] || (( smoke_port < 1 || smoke_port > 65535 )); then
  echo "RESTORE_SMOKE_API_PORT must be a valid TCP port" >&2
  exit 1
fi
(
  cd "$api_workdir"
  DATABASE_URL="$restore_database_url" API_HOST=127.0.0.1 API_PORT="$smoke_port" \
    exec node "$api_entrypoint"
) >"$work_dir/restored-api.log" 2>&1 &
api_pid="$!"

api_ready=false
for _ in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:${smoke_port}/api/v1/health/ready" >/dev/null; then
    api_ready=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "$api_ready" != "true" ]]; then
  echo "Restored database API readiness smoke test failed" >&2
  exit 1
fi
kill "$api_pid" 2>/dev/null || true
wait "$api_pid" 2>/dev/null || true
api_pid=''

echo "Backup/restore rehearsal passed: schema, table counts, forward migrations, API readiness, and media reference fields verified."
echo "Object existence still requires the separate S3 lifecycle/private-bucket verification."
