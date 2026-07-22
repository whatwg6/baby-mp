#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-ci-integration.XXXXXX")"
api_pid=''

redact_log() {
  sed -E \
    -e 's/(Bearer )[A-Za-z0-9._-]+/\1[REDACTED]/g' \
    -e 's/(token|secret|password)([^[:space:]]{0,3})[^[:space:]]+/\1\2[REDACTED]/Ig' \
    -e 's/X-Amz-[A-Za-z-]+=[^&[:space:]]+/X-Amz-[REDACTED]/g'
}

cleanup() {
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

(
  cd "$repo_root/apps/api"
  exec node dist/main.js
) >"$work_dir/api.log" 2>&1 &
api_pid="$!"

ready=false
for _ in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:${API_PORT:-3300}/api/v1/health" \
    >"$work_dir/health.json"; then
    ready=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  echo 'CI integration failed: API did not become healthy. Sanitized tail:' >&2
  tail -n 80 "$work_dir/api.log" | redact_log >&2
  exit 1
fi

if ! (
  cd "$repo_root"
  scripts/verify-m2-api.sh
  scripts/verify-m3-api.sh
  scripts/verify-m4-api.sh
  scripts/verify-m5-api.sh
  scripts/verify-m6-api.sh
  scripts/verify-m7-api.sh
); then
  echo 'CI integration failed. Sanitized API tail:' >&2
  tail -n 80 "$work_dir/api.log" | redact_log >&2
  exit 1
fi

echo 'CI integration passed: empty-database migrations, real API M2-M7 flows, private storage, export worker, privacy requests, archive and cleanup.'
