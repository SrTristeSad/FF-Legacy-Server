# aaPanel deployment

This project is designed so aaPanel/Nginx can remain responsible for websites and TLS while Docker runs the backend services.

## 1. Requirements

Install Docker and Docker Compose support on the VPS. In aaPanel, keep Nginx/Apache on the normal web ports.

## 2. Clone and initialize

```bash
cd /www/wwwroot
git clone https://github.com/SrTristeSad/FF-Legacy-Server.git
cd FF-Legacy-Server
chmod +x scripts/*.sh
./scripts/setup.sh
```

`setup.sh` creates `.env` when missing, preserves existing values on upgrades, adds new settings, and generates private match/admin secrets.

Edit `.env` before the first public test. At minimum:

- change `POSTGRES_PASSWORD`
- make `DATABASE_URL` use the same PostgreSQL password
- set `PUBLIC_HOST` to the host/IP the game client will actually reach
- keep `MATCH_HANDOFF_SECRET`, `MATCH_RESULT_SECRET`, and `ADMIN_PASSWORD` private
- keep the default `SESSION_TTL_SEC=28800` unless you intentionally want shorter sessions

## 3. Start

```bash
./scripts/start.sh
./scripts/status.sh
```

The status script checks the HTTP health endpoints and lists the Compose containers.

## 4. aaPanel reverse proxies

Create sites or proxy hosts and point them to the loopback services when needed:

- live host -> `http://127.0.0.1:19134`
- login host -> `http://127.0.0.1:19132`
- main host -> `http://127.0.0.1:19133`
- admin panel -> `http://127.0.0.1:19136`
- optional rooms/internal API host -> `http://127.0.0.1:19135`

Keep the admin service bound to `127.0.0.1` and publish it only through aaPanel/Nginx with HTTPS. The browser uses HTTP Basic authentication with `ADMIN_USER` and `ADMIN_PASSWORD` from `.env`.

The rooms service can remain internal while the legacy client protocol adapter is being developed.

## 5. Persistent data

Docker keeps state in named volumes:

- `accountdata` — accounts and active session tokens shared by login/main/gateway/admin
- `roomdata` — room and matchmaking state
- `pgdata` — PostgreSQL
- `redisdata` — Redis persistence
- `resourcecache` — cached legacy hot-update/resource files

A normal container rebuild does not erase these volumes. Avoid `docker compose down -v` on a real installation unless you intentionally want to delete persisted data.

## 6. Resource mirror/cache

The live service supports two modes:

```env
RESOURCE_MIRROR_MODE=local
```

`local` keeps the clean-room empty file manifest used by normal backend smoke tests.

To capture legacy resources through the server, change it to:

```env
RESOURCE_MIRROR_MODE=mirror
```

In mirror mode, requests under `/sbt/ABHotUpdates/` and `/live/ABHotUpdates/` are served from the persistent `resourcecache` volume. On cache miss, the service requests the matching file from the historical resource origin, streams it to the client, and saves a local copy. Cached files support HTTP byte ranges.

Do not commit downloaded game assets to the public GitHub repository. Keep them in the VPS volume.

## 7. Local accounts

The login service supports server-owned credentials with no Facebook/Google/Garena dependency:

- `POST /auth/register` — username/password registration
- `POST /auth/login` — username/password login
- `POST /auth/guest` — stable guest account keyed by device identifier

Passwords are stored as salted scrypt hashes, never plaintext.

The legacy client still needs its binary/UI adapter to call these clean-room endpoints.

## 8. TCP and UDP

The default Compose file intentionally binds gameplay services to `127.0.0.1`. When testing an external client, set `BIND_HOST=0.0.0.0` and protect the VPS firewall.

External test ports:

- live: `19134/TCP`
- login: `19132/TCP`
- main: `19133/TCP`
- gateway: `8084/TCP`
- match: `10100/UDP`

Do not expose PostgreSQL, Redis, the admin port, or storage volumes directly to the internet.

## 9. Verify the backend

With the stack running:

```bash
sh scripts/smoke-all.sh
```

The suite verifies bootstrap, existing clean-room sessions, local/guest authentication, lobby, clans, rooms, UDP handoff, economy, gameplay, and revive flows.

## 10. Updating

```bash
git pull
./scripts/setup.sh
./scripts/start.sh
./scripts/status.sh
sh scripts/smoke-all.sh
```

Running `setup.sh` after `git pull` is important because it adds newly introduced `.env` keys without replacing your existing values.

## 11. Important compatibility note

The infrastructure, account/session layer, room lifecycle and internal handoff are functional. The exact Free Fire 1.70.0 binary wire/UI adapter remains a separate compatibility step and should only be filled from independently verified client observations.
