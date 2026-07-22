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

for command in pg_dump; do
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
backup_dir="${BACKUP_DIR:-./backups/postgresql}"
age_recipient="${BACKUP_AGE_RECIPIENT:-}"

case "$app_env" in
  local|test|staging|production) ;;
  *)
    echo "APP_ENV must be local, test, staging, or production" >&2
    exit 1
    ;;
esac

if [[ "$app_env" == "staging" || "$app_env" == "production" ]]; then
  if [[ -z "$age_recipient" ]]; then
    echo "BACKUP_AGE_RECIPIENT is required for encrypted $app_env backups" >&2
    exit 1
  fi
fi

if [[ -n "$age_recipient" ]] && ! command -v age >/dev/null 2>&1; then
  echo "The age command is required when BACKUP_AGE_RECIPIENT is set" >&2
  exit 1
fi

mkdir -p "$backup_dir"
if [[ ! -d "$backup_dir" || -L "$backup_dir" ]]; then
  echo "BACKUP_DIR must be a real directory, not a symbolic link" >&2
  exit 1
fi
chmod 700 "$backup_dir"

safe_database="$(printf '%s' "$PGDATABASE" | tr -c 'A-Za-z0-9_.-' '_')"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base_name="${safe_database}-${timestamp}-$$.dump"
if [[ -n "$age_recipient" ]]; then
  base_name="${base_name}.age"
fi

final_path="$backup_dir/$base_name"
temporary_path="$backup_dir/.${base_name}.partial"
checksum_path="${final_path}.sha256"

cleanup() {
  rm -f -- "$temporary_path"
}
trap cleanup EXIT

echo "Creating a PostgreSQL custom-format backup for $app_env..." >&2
if [[ -n "$age_recipient" ]]; then
  pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    | age --encrypt --recipient "$age_recipient" --output "$temporary_path"
else
  pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file "$temporary_path"
fi

if [[ ! -s "$temporary_path" ]]; then
  echo "Backup output is empty" >&2
  exit 1
fi

chmod 600 "$temporary_path"
mv -- "$temporary_path" "$final_path"

if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$final_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "$final_path" | awk '{print $1}')"
else
  echo "sha256sum or shasum is required" >&2
  exit 1
fi
printf '%s  %s\n' "$checksum" "$base_name" >"$checksum_path"
chmod 600 "$checksum_path"

echo "Backup created and checksummed." >&2
printf '%s\n' "$final_path"
