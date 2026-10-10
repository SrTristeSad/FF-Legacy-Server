# FF Legacy Server

Clean-room server emulator project for studying compatibility with a legacy mobile battle-royale client.

> This repository does **not** contain leaked server code, game assets, proprietary keys, or official backend source code. The implementation here is written from scratch.

## Current status

The infrastructure is runnable and intended for a VPS managed with aaPanel:

- HTTP `live`, `login`, `main` and `rooms` services
- persistent accounts and expiring session tokens
- authenticated profile and lobby state
- shared account storage between login/main/gateway
- authenticated internal TCP session bridge
- persistent inventory and validated loadouts
- starter cosmetics and clean-room item catalog
- wallet with coins/gems
- clean-room shop with persistent purchase receipts
- friends, requests, blocklist and social summary
- persistent clans with owner/officer/member roles
- clan create/join/leave/kick/promote/transfer/disband flows
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
- GitHub Actions syntax/build/integration validation
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

Run the full backend integration suite with:

```bash
sh scripts/smoke-all.sh
```

It covers:

- registration/login/session/TCP auth/logout
- starter inventory and loadout validation
- shop purchase, wallet debit and receipt history
- friend request/accept/block/unblock
- clan create/join/role/ownership transfer/disband
- room create/join/ready/start/finish
- room-to-match signed handoff
- UDP match admission

TCP gateway default: `8084/TCP`

UDP match server default: `10100/UDP`

## Internal account/session API

The temporary clean-room API used while the legacy wire adapter is developed provides:

- `POST /register` on the login service
- `POST /login` on the login service
- `POST /logout` on the login service
- `GET /session` on the login service
- `GET /profile` on the main service
- `GET /lobby` on the main service
- TCP `AUTH <token>` on the gateway for the internal session bridge

Authenticated main-service areas also include inventory/loadout, shop, social/friends and clans.

Accounts, inventory, economy, social and clan data share the persistent `accountdata` Docker volume. Room state uses the separate `roomdata` volume.

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

See [`docs/ROOMS_API.md`](docs/ROOMS_API.md) for the internal room API.

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
   |                              `--> main/profile/lobby
   |                                      |-- inventory/loadout
   |                                      |-- shop/economy
   |                                      |-- friends/social
   |                                      |-- clans
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
6. Inventory/loadout/economy/social/clan foundation — done
7. Clean-room legacy packet mapping — next
8. Login/session wire adapter
9. Lobby/profile/inventory wire adapter
10. TCP notification channel wire adapter
11. Legacy matchmaking packet mapping
12. UDP realtime movement/combat protocol
13. Clash Squad gameplay state
14. Moderation and administration

## License

The clean-room code in this repository is licensed under the MIT License. Third-party game names and trademarks belong to their respective owners.
