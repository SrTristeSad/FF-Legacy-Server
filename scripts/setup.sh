#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists; leaving it unchanged"
fi

echo "FF Legacy Server is initialized."
echo "Edit .env, then run: ./scripts/start.sh"
