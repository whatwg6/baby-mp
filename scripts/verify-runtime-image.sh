#!/usr/bin/env bash
set -euo pipefail

: "${RUNTIME_IMAGE:?set RUNTIME_IMAGE to the locally built image tag or digest}"
runtime_image_reference="${RUNTIME_IMAGE_REFERENCE:-baby-mp@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"

runtime_env=(
  --env APP_ENV=staging
  --env APP_VERSION=runtime-smoke
  --env API_HOST=0.0.0.0
  --env API_PORT=3000
  --env TRUST_PROXY=false
  --env JSON_BODY_LIMIT_BYTES=262144
  --env SWAGGER_ENABLED=false
  --env INTERNAL_MONITORING_TOKEN=runtime-smoke-monitoring-token-123
  --env BUSINESS_TIME_ZONE=Asia/Shanghai
  --env CORS_ORIGINS=https://app.runtime-smoke.example
  --env DATABASE_URL=postgresql://runtime:runtime@db.runtime-smoke.example:5432/baby
  --env JWT_ACCESS_SECRET=runtime-smoke-access-secret
  --env JWT_REFRESH_SECRET=runtime-smoke-refresh-secret
  --env MOCK_AUTH_ENABLED=false
  --env WECHAT_APP_ID=wx433aecb90d44e9fe
  --env WECHAT_APP_SECRET=runtime-smoke-wechat-secret
  --env WECHAT_CODE2SESSION_URL=https://api.weixin.qq.com/sns/jscode2session
  --env S3_ENDPOINT=https://s3.runtime-smoke.example
  --env S3_REGION=runtime-smoke
  --env S3_BUCKET=baby-mp-runtime-smoke
  --env S3_ACCESS_KEY=runtime-smoke-key
  --env S3_SECRET_KEY=runtime-smoke-storage-secret
  --env S3_FORCE_PATH_STYLE=false
  --env BABY_MP_IMAGE_REF="$runtime_image_reference"
)

runtime_security=(
  --read-only
  --tmpfs /tmp:size=64m,mode=1777
  --security-opt no-new-privileges=true
  --cap-drop ALL
  --pids-limit 256
  --log-driver json-file
  --log-opt max-size=10m
  --log-opt max-file=3
)

docker run --rm "${runtime_security[@]}" "${runtime_env[@]}" "$RUNTIME_IMAGE" node -e '
  const { existsSync } = require("node:fs");
  const pkg = require("./package.json");
  const expected = {
    "media:cleanup": "node dist/media/cleanup-media.js",
    "media:cleanup:scheduler": "node dist/media/run-media-cleanup-scheduler.js",
    "exports:worker": "node dist/exports/run-export-worker.js",
    "exports:cleanup": "node dist/exports/run-export-worker.js --cleanup",
    "data-rights:transition": "node dist/data-rights/run-data-rights-transition.js",
    "prisma:deploy": "prisma migrate deploy",
  };
  for (const [name, command] of Object.entries(expected)) {
    if (pkg.scripts?.[name] !== command) throw new Error(`unexpected runtime script ${name}`);
  }
  for (const path of [
    "dist/main.js",
    "dist/config/runtime-preflight.js",
    "dist/media/cleanup-media.js",
    "dist/media/run-media-cleanup-scheduler.js",
    "dist/exports/run-export-worker.js",
    "dist/data-rights/run-data-rights-transition.js",
    "prisma/schema.prisma",
    "node_modules/prisma",
  ]) {
    if (!existsSync(path)) throw new Error(`missing runtime path ${path}`);
  }
  for (const path of [
    "src",
    "test",
    "node_modules/tsx",
    "node_modules/vitest",
    "node_modules/webpack",
    "node_modules/@tarojs",
  ]) {
    if (existsSync(path)) throw new Error(`development dependency leaked into runtime: ${path}`);
  }
'

docker run --rm "${runtime_security[@]}" "${runtime_env[@]}" "$RUNTIME_IMAGE" pnpm run prisma:deploy -- --help >/dev/null

echo 'Runtime image verification passed: production package, Prisma migration CLI, operational entries and dependency exclusions are correct.'
