# FF Legacy Server

Clean-room server emulator project for studying compatibility with a legacy mobile battle-royale client.

> This repository does **not** contain leaked server code, game assets, proprietary keys, or official backend source code. The implementation here is written from scratch.

## Current status

The infrastructure is runnable and intended for a VPS managed with aaPanel:

- HTTP `live` service
- HTTP `login` service
- HTTP `main` service
- HTTP `rooms` service
- persistent room state
- public/private rooms and invite codes
- room passwords
- owner / ready / kick / leave flow
- matchmaking queues
- Clash Squad, ranked, casual, custom and training server-side presets
- signed room-to-match handoff
- TCP gateway
- UDP match server
- UDP handoff authentication
- Redis
- PostgreSQL
- Docker Compose
- aaPanel-friendly loopback HTTP bindings
- setup/start/status/log scripts
- room lifecycle smoke test
- end-to-end room -> UDP match smoke test
- GitHub Actions syntax/build validation

The project is **not yet wire-compatible with Free Fire 1.70.4**. Client protocol compatibility must be implemented from clean-room observations/specifications.

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
node scripts/smoke-rooms.mjs
node scripts/smoke-match.mjs
```

The second test verifies the full internal flow: room creation -> signed handoff -> UDP authentication -> `WELCOME <matchId>`.

TCP gateway default: `8084/TCP`

UDP match server default: `10100/UDP`

## Room presets

Current clean-room server presets:

- `casual_solo`
- `casual_duo`
- `casual_squad`
- `ranked_solo`
- `ranked_duo`
- `ranked_squad`
- `clash_squad`
- `clash_squad_ranked`
- `custom`
- `training`

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
Legacy client
   |-- HTTP --> aaPanel/Nginx --> live/login/main
   |                              |
   |                              `--> rooms/matchmaking
   |                                      |
   |                                      `--> signed match handoff
   |
   |-- TCP ---------------------> gateway :8084
   `-- UDP ---------------------> match   :10100
                                      |
                                      `--> validates handoff + player membership

Backend storage/services:
   |-- roomdata volume
   |-- Redis
   `-- PostgreSQL
```

## Development roadmap

1. Infrastructure and service lifecycle — done
2. Room/matchmaking foundation — done
3. Signed match handoff and UDP admission — done
4. Clean-room legacy protocol documentation — next
5. Login/session wire compatibility
6. Lobby/profile/inventory wire compatibility
7. TCP notification channel compatibility
8. Legacy matchmaking packet mapping
9. UDP realtime movement/combat protocol
10. Clash Squad gameplay state
11. Persistence, moderation and administration

## License

The clean-room code in this repository is licensed under the MIT License. Third-party game names and trademarks belong to their respective owners.
