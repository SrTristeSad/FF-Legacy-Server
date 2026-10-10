# FF Legacy Server

Clean-room server emulator project for studying compatibility with a legacy mobile battle-royale client.

> This repository does **not** contain leaked server code, game assets, proprietary keys, or official backend source code. The implementation here is written from scratch.

## Current status

The infrastructure is runnable and intended for a VPS managed with aaPanel:

- HTTP `live` service
- HTTP `login` service
- HTTP `main` service
- TCP gateway
- UDP match server
- Redis
- PostgreSQL
- Docker Compose
- aaPanel-friendly loopback HTTP bindings
- simple setup/start/status/log scripts

The project is **not yet wire-compatible with Free Fire 1.70.4**. Client protocol compatibility must be implemented from clean-room observations/specifications.

## Quick start

```bash
cp .env.example .env
./scripts/setup.sh
docker compose up -d --build
./scripts/status.sh
```

Health checks:

```bash
curl http://127.0.0.1:19134/health
curl http://127.0.0.1:19132/health
curl http://127.0.0.1:19133/health
```

TCP gateway default: `8084/TCP`

UDP match server default: `10100/UDP`

## aaPanel

Use aaPanel/Nginx as the HTTPS edge and reverse-proxy these local services:

- `live.example.com` -> `127.0.0.1:19134`
- `login.example.com` -> `127.0.0.1:19132`
- `main.example.com` -> `127.0.0.1:19133`

The TCP gateway and UDP match port must be exposed directly by the VPS firewall.

See [`docs/AAPANEL.md`](docs/AAPANEL.md).

## Architecture

```text
Legacy client
   |-- HTTP --> aaPanel/Nginx --> live/login/main
   |-- TCP ---------------------> gateway :8084
   `-- UDP ---------------------> match   :10100

                      +--> Redis
                      `--> PostgreSQL
```

## Development roadmap

1. Infrastructure and service lifecycle
2. Clean-room protocol documentation
3. Login/session compatibility
4. Lobby/profile/inventory compatibility
5. TCP notification channel
6. Matchmaking
7. UDP realtime match protocol
8. Clash Squad gameplay state
9. Persistence and administration

## License

The clean-room code in this repository is licensed under the MIT License. Third-party game names and trademarks belong to their respective owners.
