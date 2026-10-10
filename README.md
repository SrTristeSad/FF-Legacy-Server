# FF Legacy Server

Clean-room server emulator project for studying compatibility with a legacy mobile battle-royale client.

> This repository does **not** contain leaked server code, game assets, proprietary keys, or official backend source code. The implementation here is written from scratch.

## Current status

The infrastructure is runnable and intended for a VPS managed with aaPanel:

- HTTP `live` service
- HTTP `login` service
- HTTP `main` service
- persistent accounts and expiring session tokens
- authenticated profile and lobby state
- shared account storage between login/main/gateway
- authenticated internal TCP session bridge
- HTTP `rooms` service
- persistent room state
- public/private rooms and invite codes
- room passwords
- owner / ready / kick / leave / finish flow
- matchmaking queues
- Battle Royale, Clash Squad, ranked, casual, custom and training server-side presets
- historical/temporary presets for Lone Wolf, Lone Wolf Strike Out, Creation Workshop, Parkour and Pet Ludo
- signed room-to-match handoff
- TCP gateway
- UDP match server
- UDP handoff authentication
- Redis
- PostgreSQL
- Docker Compose
- aaPanel-friendly loopback HTTP bindings
- setup/start/status/log scripts
- repeatable room lifecycle smoke test
- end-to-end room -> UDP match smoke test
- end-to-end account -> login -> lobby -> TCP gateway smoke test
- GitHub Actions syntax/build validation
- Go tests for handoff verification

The project is **not yet wire-compatible with Free Fire 1.70.4**. The exact proprietary binary adapter is intentionally kept separate until its packet mapping is independently verified from a client we are authorized to test.

## Quick start

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
./scripts/start.sh
./scripts/status.sh
```

`setup.sh` creates `.env` when needed and replaces the development handoff secret with a private random value. Edit `PUBLIC_HOST`, PostgreSQL credentials and any deployment-specific values before exposing the service.

Health checks:

```bash
curl http://127.0.0.1:19134/health
curl http://127.0.0.1:19132/health
curl http://127.0.0.1:19133/health
curl http://127.0.0.1:19135/health
```

Backend smoke tests:

```bash
node scripts/smoke-session.mjs
node scripts/smoke-rooms.mjs
node scripts/smoke-match.mjs
```

The session test verifies account registration, persistent login token issuance, authenticated profile/lobby access, TCP gateway authentication and logout. The match test verifies room creation -> signed handoff -> UDP authentication -> `WELCOME <matchId>` -> room cleanup.

TCP gateway default: `8084/TCP`

UDP match server default: `10100/UDP`

## Internal account/session API

The temporary clean-room API used while the legacy wire adapter is developed provides:

- `POST /register` on the login service
- `POST /login` on the login service
- `POST /logout` on the login service
- `GET /session` on the login service
- `GET /profile` on the main service with `Authorization: Bearer <token>`
- `GET /lobby` on the main service with `Authorization: Bearer <token>`
- TCP `AUTH <token>` on the gateway for the internal session bridge

Accounts and sessions are stored in the shared `accountdata` Docker volume, so recreating the login/main/gateway containers does not erase them.

## Room presets

Current clean-room server presets include:

- `casual_solo`
- `casual_duo`
- `casual_squad`
- `ranked_solo`
- `ranked_duo`
- `ranked_squad`
- `clash_squad`
- `clash_squad_ranked`
- `lone_wolf`
- `lone_wolf_strikeout`
- `creation_workshop`
- `parkour`
- `pet_ludo`
- `custom`
- `training`

The historical/temporary presets are provisional until the exact 1.70.4 packet/config mapping is independently verified.

See [`docs/ROOMS_API.md`](docs/ROOMS_API.md) for the internal API.

## aaPanel

Use aaPanel/Nginx as the HTTPS edge and reverse-proxy these local services when needed:

- `live.example.com` -> `127.0.0.1:19134`
- `login.example.com` -> `127.0.0.1:19132`
- `main.example.com` -> `127.0.0.1:19133`
- optional internal/API host -> `127.0.0.1:19135`

The TCP gateway and UDP match port are loopback-bound by default in Docker Compose. Expose them deliberately only after the VPS firewall and deployment configuration are ready.

See [`docs/AAPANEL.md`](docs/AAPANEL.md).

## Architecture

```text
Legacy client / test client
   |-- HTTP --> aaPanel/Nginx --> login --> accountdata
   |                              |
   |                              `--> main/profile/lobby --> accountdata
   |                                      |
   |                                      `--> rooms/matchmaking
   |                                               |
   |                                               `--> signed match handoff
   |
   |-- TCP ---------------------> gateway :8084 --> validates session in accountdata
   `-- UDP ---------------------> match   :10100 --> validates handoff + membership

Backend storage/services:
   |-- accountdata volume
   |-- roomdata volume
   |-- Redis
   `-- PostgreSQL
```

## Development roadmap

1. Infrastructure and service lifecycle — done
2. Room/matchmaking foundation — done
3. Historical room preset catalog — done
4. Signed match handoff and UDP admission — done
5. Persistent account/session/lobby foundation — done
6. Clean-room legacy packet mapping — next
7. Login/session wire adapter
8. Lobby/profile/inventory wire adapter
9. TCP notification channel wire adapter
10. Legacy matchmaking packet mapping
11. UDP realtime movement/combat protocol
12. Clash Squad gameplay state
13. Persistence, moderation and administration

## License

The clean-room code in this repository is licensed under the MIT License. Third-party game names and trademarks belong to their respective owners.
