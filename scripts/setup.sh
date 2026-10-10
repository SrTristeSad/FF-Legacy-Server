#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

created_env=false
if [ ! -f .env ]; then
  cp .env.example .env
  created_env=true
fi

if grep -q '^MATCH_HANDOFF_SECRET=dev-change-me$' .env; then
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
  else
    secret="$(date +%s%N 2>/dev/null || date +%s)-$$"
  fi
  sed -i "s/^MATCH_HANDOFF_SECRET=dev-change-me$/MATCH_HANDOFF_SECRET=${secret}/" .env
  echo "Generated MATCH_HANDOFF_SECRET"
fi

if [ "$created_env" = true ]; then
  echo "Created .env from .env.example"
else
  echo ".env already exists; preserved existing values"
fi

echo "FF Legacy Server is initialized."
echo "Edit PUBLIC_HOST and credentials in .env, then run: ./scripts/start.sh"
