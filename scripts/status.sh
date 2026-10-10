#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

docker compose ps

echo
printf 'live:  '
curl -fsS http://127.0.0.1:${LIVE_PORT:-19134}/health || true
echo
printf 'login: '
curl -fsS http://127.0.0.1:${LOGIN_PORT:-19132}/health || true
echo
printf 'main:  '
curl -fsS http://127.0.0.1:${MAIN_PORT:-19133}/health || true
echo
printf 'rooms: '
curl -fsS http://127.0.0.1:${ROOMS_PORT:-19135}/health || true
echo
