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

`setup.sh` creates `.env` when missing and replaces the development match-handoff secret with a random value.

Edit `.env` before the first public test. At minimum:

- change `POSTGRES_PASSWORD`
- make `DATABASE_URL` use the same PostgreSQL password
- set `PUBLIC_HOST` to the host/IP the game client will actually reach
- keep `MATCH_HANDOFF_SECRET` private
- keep the default `SESSION_TTL_SEC=28800` unless you intentionally want shorter sessions

## 3. Start

```bash
./scripts/start.sh
./scripts/status.sh
```

The status script checks the HTTP health endpoints and lists the Compose containers.

## 4. aaPanel reverse proxies

Create sites or proxy hosts and point them to the loopback services:

- live host -> `http://127.0.0.1:19134`
- login host -> `http://127.0.0.1:19132`
- main host -> `http://127.0.0.1:19133`
- optional rooms/internal API host -> `http://127.0.0.1:19135`

The rooms service can remain internal while the legacy client protocol adapter is being developed.

TLS can be managed normally by aaPanel.

## 5. Persistent data

Docker keeps state in named volumes:

- `accountdata` — accounts and active session tokens shared by login/main/gateway
- `roomdata` — room and matchmaking state
- `pgdata` — PostgreSQL
- `redisdata` — Redis persistence

A normal container rebuild does not erase these volumes. Avoid `docker compose down -v` on a real installation unless you intentionally want to delete persisted data.

## 6. TCP and UDP

The default Compose file intentionally binds the TCP gateway and UDP match service to `127.0.0.1`. This makes a fresh installation safe by default.

When you are ready to test an external client, change only these mappings in `docker-compose.yml` from `127.0.0.1:` to the desired public bind address and allow the corresponding ports in the VPS firewall:

- gateway: `8084/TCP`
- match: `10100/UDP`

Do not expose PostgreSQL, Redis or the storage volumes publicly.

## 7. Verify the backend before testing a client

With the stack running:

```bash
sh scripts/smoke-all.sh
```

This runs three checks:

1. account registration -> login -> profile/lobby -> TCP gateway auth -> logout
2. room creation -> join -> ready -> room start/finish
3. signed room handoff -> UDP match authentication

These checks prove the clean-room backend works independently of the legacy client adapter.

## 8. Updating

```bash
git pull
./scripts/start.sh
./scripts/status.sh
sh scripts/smoke-all.sh
```

## 9. Important compatibility note

The infrastructure, account/session layer, room lifecycle and internal handoff are functional. The exact legacy binary wire adapter is still a separate development step and should only be filled from independently verified client observations.
