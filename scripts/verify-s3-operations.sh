#!/usr/bin/env bash
set -euo pipefail

for command in aws curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"

app_env="${APP_ENV:-local}"
case "$app_env" in
  local|test|staging|production) ;;
  *)
    echo "APP_ENV must be local, test, staging, or production" >&2
    exit 1
    ;;
esac

case "$S3_ENDPOINT" in
  http://*|https://*) ;;
  *)
    echo "S3_ENDPOINT must be an HTTP(S) URL" >&2
    exit 1
    ;;
esac
if [[ ! "$S3_BUCKET" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$ ]]; then
  echo "S3_BUCKET has an unsafe or invalid value" >&2
  exit 1
fi

aws_args=(--endpoint-url "$S3_ENDPOINT" --region "$S3_REGION")
anonymous_bucket_url="${S3_ANONYMOUS_BUCKET_URL:-${S3_ENDPOINT%/}/${S3_BUCKET}}"
if [[ "$anonymous_bucket_url" == *'?'* || "$anonymous_bucket_url" == *'#'* ]]; then
  echo "S3_ANONYMOUS_BUCKET_URL must not contain query parameters or fragments" >&2
  exit 1
fi
if [[ "$app_env" == "staging" || "$app_env" == "production" ]]; then
  if [[ "$S3_ENDPOINT" != https://* || "$anonymous_bucket_url" != https://* ]]; then
    echo "S3 endpoints must use HTTPS outside local/test" >&2
    exit 1
  fi
fi
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/baby-mp-s3-verify.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

aws "${aws_args[@]}" s3api head-bucket --bucket "$S3_BUCKET"
aws "${aws_args[@]}" s3api get-bucket-lifecycle-configuration \
  --bucket "$S3_BUCKET" >"$work_dir/lifecycle.json"

jq --exit-status '
  any(.Rules[]?;
    .Status == "Enabled" and
    ((.Filter.Prefix // .Prefix) == "exports/") and
    (.Expiration.Days == 7) and
    (.NoncurrentVersionExpiration.NoncurrentDays <= 1)
  )
' "$work_dir/lifecycle.json" >/dev/null

if ! jq --exit-status '
  any(.Rules[]?;
    .Status == "Enabled" and
    ((.Filter.Prefix // .Prefix) == "exports/") and
    (.AbortIncompleteMultipartUpload.DaysAfterInitiation <= 1)
  )
' "$work_dir/lifecycle.json" >/dev/null; then
  if [[ "$app_env" == "staging" || "$app_env" == "production" ]]; then
    echo "Export lifecycle does not abort incomplete multipart uploads within one day" >&2
    exit 1
  fi
  echo "Local object store omitted multipart lifecycle cleanup; verify the export worker fallback." >&2
fi

aws "${aws_args[@]}" s3api get-bucket-versioning --bucket "$S3_BUCKET" >"$work_dir/versioning.json"
if jq --exit-status '.Status == "Enabled"' "$work_dir/versioning.json" >/dev/null; then
  echo "Bucket versioning retains deleted private objects; disable it or implement version-aware purging" >&2
  exit 1
fi

anonymous_list_status="$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    "${anonymous_bucket_url%/}?list-type=2&max-keys=1"
)"
case "$anonymous_list_status" in
  401|403) ;;
  *)
    echo "Anonymous bucket listing was not denied (HTTP $anonymous_list_status)" >&2
    exit 1
    ;;
esac

probe_key="${S3_PRIVATE_PROBE_KEY:-}"
if [[ -n "$probe_key" ]]; then
  if [[ ! "$probe_key" =~ ^[A-Za-z0-9._/-]+$ || "$probe_key" == /* || "$probe_key" == *..* ]]; then
    echo "S3_PRIVATE_PROBE_KEY must be a URL-safe relative object key" >&2
    exit 1
  fi
  aws "${aws_args[@]}" s3api head-object --bucket "$S3_BUCKET" --key "$probe_key" >/dev/null
  anonymous_read_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      "${anonymous_bucket_url%/}/${probe_key}"
  )"
  case "$anonymous_read_status" in
    401|403) ;;
    *)
      echo "Anonymous object read was not denied (HTTP $anonymous_read_status)" >&2
      exit 1
      ;;
  esac
elif [[ "$app_env" == "staging" || "$app_env" == "production" ]]; then
  echo "S3_PRIVATE_PROBE_KEY is required outside local/test to prove anonymous reads are denied" >&2
  exit 1
else
  echo "No private object probe supplied; anonymous read check skipped for local/test." >&2
fi

if [[ "$app_env" == "staging" || "$app_env" == "production" ]]; then
  aws "${aws_args[@]}" s3api get-bucket-encryption --bucket "$S3_BUCKET" \
    | jq --exit-status '.ServerSideEncryptionConfiguration.Rules | length > 0' >/dev/null
fi

echo "S3 checks passed: operator access, export lifecycle, private access, and required encryption were verified."
