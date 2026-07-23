#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preflight="${RUNTIME_PREFLIGHT_PATH:-$repo_root/apps/api/dist/config/runtime-preflight.js}"
runtime_compose="$repo_root/deploy/runtime-compose.sh"
digest='baby-mp@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

if [[ ! -f "$preflight" ]]; then
  echo "Runtime preflight verification failed: build the API first ($preflight is missing)" >&2
  exit 1
fi

run_preflight() {
  env -i \
    PATH="$PATH" \
    APP_ENV=staging \
    APP_VERSION=audit-commit \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    TRUST_PROXY=false \
    JSON_BODY_LIMIT_BYTES=262144 \
    SWAGGER_ENABLED=false \
    INTERNAL_MONITORING_TOKEN=audit-only-monitoring-token-123456 \
    BUSINESS_TIME_ZONE=Asia/Shanghai \
    CORS_ORIGINS=https://app.audit.example \
    DATABASE_URL='postgresql://audit:audit@db.audit.example:5432/baby' \
    JWT_ACCESS_SECRET=audit-only-access-secret \
    JWT_REFRESH_SECRET=audit-only-refresh-secret \
    MOCK_AUTH_ENABLED=false \
    WECHAT_APP_ID=wx433aecb90d44e9fe \
    WECHAT_APP_SECRET=audit-only-wechat-secret \
    WECHAT_CODE2SESSION_URL=https://api.weixin.qq.com/sns/jscode2session \
    S3_ENDPOINT=https://s3.audit.example \
    S3_REGION=audit-region \
    S3_BUCKET=baby-mp-audit \
    S3_ACCESS_KEY=audit-access-key \
    S3_SECRET_KEY=audit-storage-secret \
    S3_FORCE_PATH_STYLE=false \
    BABY_MP_IMAGE_REF="$digest" \
    "$@" \
    node "$preflight" node -e 'process.exit(0)'
}

expect_rejected() {
  local label="$1"
  shift
  if run_preflight "$@" >/dev/null 2>&1; then
    echo "Runtime preflight verification failed: accepted $label" >&2
    exit 1
  fi
}

run_preflight >/dev/null
run_preflight \
  APP_ENV=production \
  DATABASE_URL='postgresql://audit:audit@db.audit.example:5432/baby?sslmode=require' \
  >/dev/null

expect_rejected 'local APP_ENV' APP_ENV=local
expect_rejected 'a mutable image tag' BABY_MP_IMAGE_REF=baby-mp:latest
expect_rejected 'an insecure staging S3 endpoint' S3_ENDPOINT=http://s3.audit.example
expect_rejected 'a production database without SSL' APP_ENV=production
expect_rejected 'a local example secret' JWT_ACCESS_SECRET=local-only-secret

APP_ENV=staging BABY_MP_IMAGE="$digest" "$runtime_compose" --preflight-only
if APP_ENV=local BABY_MP_IMAGE="$digest" "$runtime_compose" --preflight-only >/dev/null 2>&1; then
  echo 'Runtime preflight verification failed: compose wrapper accepted APP_ENV=local' >&2
  exit 1
fi
if APP_ENV=staging BABY_MP_IMAGE=baby-mp:latest "$runtime_compose" --preflight-only >/dev/null 2>&1; then
  echo 'Runtime preflight verification failed: compose wrapper accepted a mutable image tag' >&2
  exit 1
fi

echo 'Runtime preflight verification passed: safe staging/production accepted and unsafe configurations rejected.'
