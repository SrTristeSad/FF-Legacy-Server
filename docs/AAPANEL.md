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

## 5. TCP and UDP

The default Compose file intentionally binds the TCP gateway and UDP match service to `127.0.0.1`. This makes a fresh installation safe by default.

When you are ready to test an external client, change only these mappings in `docker-compose.yml` from `127.0.0.1:` to the desired public bind address and allow the corresponding ports in the VPS firewall:

- gateway: `8084/TCP`
- match: `10100/UDP`

Do not expose PostgreSQL, Redis or the rooms storage volume publicly.

## 6. Test rooms before testing the client

With the stack running:

```bash
node scripts/smoke-rooms.mjs
```

That verifies:

1. room service health
2. Clash Squad room creation
3. second player joining
4. ready state
5. room start
6. signed UDP match handoff

This does not prove legacy client compatibility. It proves the clean-room backend flow works independently of the client adapter.

## 7. Updating

```bash
git pull
./scripts/start.sh
./scripts/status.sh
```

## 8. Important compatibility note

The infrastructure, room lifecycle and internal handoff are functional, but the wire protocol implemented here is still a clean-room bootstrap. A legacy client will not complete the original game's login/lobby/gameplay flow until those packet formats are independently documented and implemented.
