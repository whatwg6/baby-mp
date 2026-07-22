#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
playwright_bin="${PLAYWRIGHT_BIN:-${RUNNER_TEMP:-}/baby-mp-playwright/node_modules/.bin/playwright}"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-h5-e2e.XXXXXX")"
api_pid=''
web_pid=''
worker_pid=''

api_port="${API_PORT:-3300}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:${api_port}/api/v1}"
export H5_BASE_URL="${H5_BASE_URL:-http://127.0.0.1:10086}"
h5_port="$(node -e '
  const url = new URL(process.argv[1])
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/") process.exit(1)
  process.stdout.write(url.port || "80")
' "$H5_BASE_URL")" || {
  echo 'H5 E2E failed: H5_BASE_URL must be a loopback HTTP origin' >&2
  exit 1
}

cleanup() {
  for pid in "$web_pid" "$worker_pid" "$api_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

if [[ ! -x "$playwright_bin" ]]; then
  echo "H5 E2E failed: Playwright executable is unavailable at $playwright_bin" >&2
  exit 1
fi

(
  cd "$repo_root/apps/api"
  exec node dist/main.js
) >"$work_dir/api.log" 2>&1 &
api_pid="$!"

(
  cd "$repo_root/apps/api"
  exec node dist/exports/run-export-worker.js
) >"$work_dir/worker.log" 2>&1 &
worker_pid="$!"

(
  cd "$repo_root/apps/client/dist/h5"
  exec python3 -m http.server "$h5_port" --bind 127.0.0.1
) >"$work_dir/web.log" 2>&1 &
web_pid="$!"

for url in \
  "${E2E_API_BASE_URL}/health" \
  "${H5_BASE_URL}/"; do
  ready=false
  for _ in $(seq 1 60); do
    if ! kill -0 "$worker_pid" 2>/dev/null; then
      echo 'H5 E2E failed: export worker exited before readiness' >&2
      exit 1
    fi
    if curl --silent --fail "$url" >/dev/null; then ready=true; break; fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo "H5 E2E failed: service did not become available at $url" >&2
    exit 1
  fi
done

cd "$repo_root"
"$playwright_bin" test --config=e2e/playwright.config.cjs
