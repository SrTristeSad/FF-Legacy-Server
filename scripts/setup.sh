#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env

  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
  else
    secret="$(date +%s%N 2>/dev/null || date +%s)-$$"
  fi

  # Replace only the development placeholder copied from .env.example.
  sed -i "s/^MATCH_HANDOFF_SECRET=dev-change-me$/MATCH_HANDOFF_SECRET=${secret}/" .env
  echo "Created .env and generated MATCH_HANDOFF_SECRET"
else
  echo ".env already exists; leaving it unchanged"
fi

echo "FF Legacy Server is initialized."
echo "Edit PUBLIC_HOST and credentials in .env, then run: ./scripts/start.sh"
