#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

node scripts/smoke-live.mjs
node scripts/smoke-session.mjs
node scripts/smoke-auth.mjs
node scripts/smoke-lobby.mjs
node scripts/smoke-clan.mjs
node scripts/smoke-rooms.mjs
node scripts/smoke-match.mjs
node scripts/smoke-economy.mjs
node scripts/smoke-gameplay.mjs
node scripts/smoke-revive.mjs

echo "all smoke tests: OK"
