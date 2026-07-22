#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
h5_dir="${H5_ARTIFACT_DIR:-$repo_root/apps/client/dist/h5}"
weapp_dir="${WEAPP_ARTIFACT_DIR:-$repo_root/apps/client/dist/weapp}"
h5_budget="${H5_ARTIFACT_BUDGET_BYTES:-10485760}"
h5_js_gzip_budget="${H5_JS_GZIP_BUDGET_BYTES:-2621440}"
h5_single_js_gzip_budget="${H5_SINGLE_JS_GZIP_BUDGET_BYTES:-163840}"

resolve_weapp_budget() {
  local canonical="${WEAPP_BUNDLE_BUDGET_BYTES:-}"
  local legacy="${WEAPP_ARTIFACT_BUDGET_BYTES:-}"
  local name value
  for name in WEAPP_BUNDLE_BUDGET_BYTES WEAPP_ARTIFACT_BUDGET_BYTES; do
    value="${!name:-}"
    if [[ -n "$value" && ! "$value" =~ ^[1-9][0-9]*$ ]]; then
      echo "Artifact budget failed: $name must be a positive integer" >&2
      return 1
    fi
    if [[ ${#value} -gt 16 ]] ||
      [[ ${#value} -eq 16 && "$value" > 9007199254740991 ]]; then
      echo "Artifact budget failed: $name exceeds the safe integer range" >&2
      return 1
    fi
  done
  if [[ -n "$canonical" && -n "$legacy" && "$canonical" != "$legacy" ]]; then
    echo 'Artifact budget failed: WEAPP_BUNDLE_BUDGET_BYTES conflicts with legacy WEAPP_ARTIFACT_BUDGET_BYTES' >&2
    return 1
  fi
  printf '%s\n' "${canonical:-${legacy:-2097152}}"
}

weapp_budget="$(resolve_weapp_budget)"

require_directory() {
  if [[ ! -d "$1" ]]; then
    echo "Artifact budget failed: missing build directory $1" >&2
    exit 1
  fi
}

measure_directory() {
  local directory="$1"
  local total=0
  local largest=0
  local largest_file=''
  local file bytes
  while IFS= read -r -d '' file; do
    bytes="$(wc -c <"$file" | tr -d '[:space:]')"
    total=$((total + bytes))
    if ((bytes > largest)); then
      largest="$bytes"
      largest_file="${file#"$repo_root/"}"
    fi
  done < <(find "$directory" -type f -print0)
  printf '%s:%s:%s\n' "$total" "$largest" "$largest_file"
}

measure_gzipped_javascript() {
  local directory="$1"
  local total=0
  local largest=0
  local largest_file=''
  local file bytes
  while IFS= read -r -d '' file; do
    bytes="$(gzip -9 -c <"$file" | wc -c | tr -d '[:space:]')"
    total=$((total + bytes))
    if ((bytes > largest)); then
      largest="$bytes"
      largest_file="${file#"$repo_root/"}"
    fi
  done < <(find "$directory" -type f -name '*.js' -print0)
  printf '%s:%s:%s\n' "$total" "$largest" "$largest_file"
}

assert_budget() {
  local label="$1"
  local actual="$2"
  local budget="$3"
  if ((actual > budget)); then
    echo "Artifact budget failed: $label is $actual bytes (budget $budget bytes)" >&2
    exit 1
  fi
}

require_directory "$h5_dir"
require_directory "$weapp_dir"

if [[ ! -s "$h5_dir/favicon.svg" ]]; then
  echo 'Artifact verification failed: H5 favicon.svg is missing or empty' >&2
  exit 1
fi
if ! grep -Fq 'href="/favicon.svg"' "$h5_dir/index.html"; then
  echo 'Artifact verification failed: H5 index.html does not reference favicon.svg' >&2
  exit 1
fi

IFS=: read -r h5_total h5_largest h5_largest_file <<<"$(measure_directory "$h5_dir")"
IFS=: read -r h5_js_gzip h5_largest_js_gzip h5_largest_js_file \
  <<<"$(measure_gzipped_javascript "$h5_dir")"
IFS=: read -r weapp_total _ _ <<<"$(measure_directory "$weapp_dir")"

assert_budget 'H5 total' "$h5_total" "$h5_budget"
assert_budget 'H5 JavaScript gzip total' "$h5_js_gzip" "$h5_js_gzip_budget"
assert_budget \
  "H5 largest JavaScript gzip chunk ($h5_largest_js_file)" \
  "$h5_largest_js_gzip" \
  "$h5_single_js_gzip_budget"
assert_budget 'WeChat main package total' "$weapp_total" "$weapp_budget"

if find "$h5_dir" "$weapp_dir" -type f -name '*.map' -print -quit | grep -q .; then
  echo 'Artifact budget failed: production artifacts contain source maps' >&2
  exit 1
fi

echo "Artifact budgets passed: H5=${h5_total}/${h5_budget} raw bytes, H5 JS gzip=${h5_js_gzip}/${h5_js_gzip_budget} bytes (largest=${h5_largest_js_gzip}/${h5_single_js_gzip_budget}), WeChat=${weapp_total}/${weapp_budget} bytes."
