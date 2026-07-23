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
    echo "Unable to verify $label permissions; restore refused" >&2
    return 1
  fi
  if [[ ! "$mode" =~ ^[0-7]{3,4}$ ]] || (( (8#$mode & 8#7177) != 0 )); then
    echo "$label permissions must not be broader than 0600 (found $mode)" >&2
    return 1
  fi
}

if [[ "$#" -ne 1 ]]; then
  echo "Usage: $0 /protected/path/database.dump[.age]" >&2
  exit 2
fi

for command in pg_restore psql; do
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

backup_path="$1"
checksum_path="${backup_path}.sha256"
app_env="${APP_ENV:-local}"
expected_confirmation="${PGHOST}:${PGPORT}/${PGDATABASE}"

case "$app_env" in
  local|test|staging|production) ;;
  *)
    echo "APP_ENV must be local, test, staging, or production" >&2
    exit 1
    ;;
esac

if [[ ! -f "$backup_path" || -L "$backup_path" ]]; then
  echo "Backup must be a regular file, not a symbolic link" >&2
  exit 1
fi
if [[ ! -f "$checksum_path" || -L "$checksum_path" ]]; then
  echo "Missing checksum sidecar: ${checksum_path}" >&2
  exit 1
fi
if [[ "${RESTORE_CONFIRM:-}" != "$expected_confirmation" ]]; then
  echo "Restore refused. Set RESTORE_CONFIRM exactly to: $expected_confirmation" >&2
  exit 1
fi
if [[ "$app_env" == "production" && "${RESTORE_PRODUCTION_APPROVED:-}" != "I_ACCEPT_PRODUCTION_RESTORE" ]]; then
  echo "Production restore refused without RESTORE_PRODUCTION_APPROVED=I_ACCEPT_PRODUCTION_RESTORE" >&2
  exit 1
fi

checksum_file_name="$(awk 'NR == 1 { print $2 }' "$checksum_path")"
if [[ "$checksum_file_name" != "$(basename "$backup_path")" ]]; then
  echo "Checksum sidecar does not name the selected backup" >&2
  exit 1
fi
expected_checksum="$(awk 'NR == 1 { print $1 }' "$checksum_path")"
if [[ ! "$expected_checksum" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Checksum sidecar is malformed" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$backup_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$backup_path" | awk '{print $1}')"
else
  echo "sha256sum or shasum is required" >&2
  exit 1
fi
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "Backup checksum verification failed" >&2
  exit 1
fi

connected_database="$(psql --no-psqlrc --tuples-only --no-align --command 'SELECT current_database()')"
if [[ "$connected_database" != "$PGDATABASE" ]]; then
  echo "Connected database does not match PGDATABASE; restore refused" >&2
  exit 1
fi

user_table_count="$(
  psql --no-psqlrc --tuples-only --no-align --command \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
)"
if [[ "$user_table_count" != "0" ]]; then
  echo "Target database is not empty; restore refused" >&2
  exit 1
fi

restore_args=(
  --exit-on-error
  --single-transaction
  --no-owner
  --no-privileges
  --dbname "$PGDATABASE"
)

echo "Checksum valid; restoring into the confirmed empty target..." >&2
if [[ "$backup_path" == *.age ]]; then
  : "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required for an encrypted backup}"
  validate_sensitive_file "$AGE_IDENTITY_FILE" AGE_IDENTITY_FILE
  if ! command -v age >/dev/null 2>&1; then
    echo "The age command is required for an encrypted backup" >&2
    exit 1
  fi
  age --decrypt --identity "$AGE_IDENTITY_FILE" "$backup_path" \
    | pg_restore "${restore_args[@]}"
else
  pg_restore "${restore_args[@]}" "$backup_path"
fi

migration_table_count="$(
  psql --no-psqlrc --tuples-only --no-align --command \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations';"
)"
if [[ "$migration_table_count" != "1" ]]; then
  echo "Restore finished but the Prisma migration table is missing" >&2
  exit 1
fi

echo "Restore completed and the migration table is present." >&2
