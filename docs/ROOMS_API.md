# Rooms and matchmaking API

The rooms service is a clean-room internal API used by the server stack while legacy wire compatibility is developed.

Default local address: `http://127.0.0.1:19135`

## Supported room presets

Core presets:

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

Historical/temporary presets currently represented in the clean-room backend:

- `lone_wolf`
- `lone_wolf_strikeout`
- `creation_workshop`
- `parkour`
- `pet_ludo`

The temporary/historical presets model known game modes from the same general 2022-era branch, but they do not claim exact wire compatibility with a particular proprietary client build until the 1.70.4 client mapping is independently verified.

`lone_wolf_strikeout` is modeled for eight players. `creation_workshop` is capped at 12 players and carries metadata for up to 12 teams with a maximum team size of six; the future protocol adapter will map the exact client configuration into this generic representation.

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

`POST /rooms/finish`

```json
{
  "roomId": "room-uuid",
  "playerId": "1001"
}
```

The room owner finishes the match, the room is closed, and every member is released so they can join another room or matchmaking queue.

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

## Smoke tests

With the stack running:

```bash
node scripts/smoke-rooms.mjs
node scripts/smoke-match.mjs
```

The first test covers room creation, join, ready, mode catalog, match handoff and room cleanup. The second test verifies the signed handoff against the UDP match server and then closes the room.
