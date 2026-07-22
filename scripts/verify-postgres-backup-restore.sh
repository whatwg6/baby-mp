#!/usr/bin/env bash
set -euo pipefail

umask 077

for command in createdb dropdb psql; do
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
if [[ -n "${PGPASSFILE:-}" && ( ! -f "$PGPASSFILE" || -L "$PGPASSFILE" ) ]]; then
  echo "PGPASSFILE must be a protected regular file" >&2
  exit 1
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
  if [[ -z "${AGE_IDENTITY_FILE:-}" || ! -f "$AGE_IDENTITY_FILE" || -L "$AGE_IDENTITY_FILE" ]]; then
    echo "AGE_IDENTITY_FILE must be a protected regular file for an encrypted rehearsal" >&2
    exit 1
  fi
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
target_created=false

cleanup() {
  local original_status=$?
  local cleanup_failed=false
  set +e
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

echo "Backup/restore rehearsal passed: schema, table counts, migrations, and media reference fields verified."
echo "Object existence still requires the separate S3 lifecycle/private-bucket verification."
