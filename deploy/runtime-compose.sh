#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/deploy/compose.runtime.yml"

case "${APP_ENV:-}" in
  staging|production) ;;
  *)
    echo 'Runtime deployment refused: APP_ENV must be staging or production' >&2
    exit 1
    ;;
esac

if [[ ! "${BABY_MP_IMAGE:-}" =~ ^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$ ]]; then
  echo 'Runtime deployment refused: BABY_MP_IMAGE must use an immutable @sha256 digest' >&2
  exit 1
fi

if [[ "${1:-}" == '--preflight-only' ]]; then
  exit 0
fi

if docker compose version >/dev/null 2>&1; then
  exec docker compose -f "$compose_file" "$@"
fi
if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose -f "$compose_file" "$@"
fi

echo 'Runtime deployment refused: Docker Compose is unavailable' >&2
exit 1
