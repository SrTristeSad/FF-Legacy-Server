# Rooms and matchmaking API

The rooms service is a clean-room internal API used by the server stack while legacy wire compatibility is developed.

Default local address: `http://127.0.0.1:19135`

## Supported room presets

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

These are server-side presets and do not claim exact wire compatibility with a particular proprietary client build.

## Endpoints

### Discovery

- `GET /health`
- `GET /modes`
- `GET /rooms`
- `GET /rooms?mode=clash_squad`
- `GET /rooms/get?roomId=<uuid>`
- `GET /rooms/get?code=<invite-code>`

### Room lifecycle

`POST /rooms/create`

```json
{
  "playerId": "1001",
  "nickname": "Player",
  "mode": "clash_squad",
  "private": false,
  "password": null
}
```

`POST /rooms/join`

```json
{
  "roomId": "room-uuid",
  "playerId": "1002",
  "nickname": "Player2"
}
```

A room can also be joined with its short `code` instead of `roomId`.

`POST /rooms/ready`

```json
{
  "roomId": "room-uuid",
  "playerId": "1002",
  "ready": true
}
```

`POST /rooms/kick`

```json
{
  "roomId": "room-uuid",
  "actorId": "1001",
  "targetId": "1002"
}
```

`POST /rooms/leave`

```json
{
  "playerId": "1002"
}
```

`POST /rooms/start`

```json
{
  "roomId": "room-uuid",
  "playerId": "1001"
}
```

A successful start returns a match handoff containing the public UDP host, UDP port, match id, expiry and a signed token. The token format is currently internal to this project and will later be mapped to the independently documented legacy protocol.

## Matchmaking queue

`POST /queue/join`

```json
{
  "playerId": "1001",
  "nickname": "Player",
  "mode": "clash_squad"
}
```

When enough players for the preset have queued, the service creates a room, assigns teams, marks the queued players ready and creates a match handoff.

`GET /queue/status?playerId=1001`

`POST /queue/leave`

```json
{
  "playerId": "1001"
}
```

## Persistence

Room and queue state is stored in `/data/rooms.json` inside the rooms container. Docker Compose mounts the `roomdata` volume at `/data`, so container recreation does not erase room state.

## Smoke test

With the stack running:

```bash
node scripts/smoke-rooms.mjs
```

The test covers room creation, join, ready and match handoff generation.
