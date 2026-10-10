#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

node scripts/smoke-session.mjs
node scripts/smoke-lobby.mjs
node scripts/smoke-clan.mjs
node scripts/smoke-rooms.mjs
node scripts/smoke-match.mjs

echo "all smoke tests: OK"
