# Internal realtime match protocol

This is the clean-room protocol used to exercise the server while the legacy client adapter is developed. It is intentionally simple and is **not** the proprietary Free Fire wire format.

Default transport: UDP on `GAME_SERVER_PORT` (`10100`).

## Authentication

A room start returns a signed handoff token. Each player authenticates its UDP endpoint with:

```text
HELLO <handoff-token> <player-id>
```

Success:

```text
WELCOME <match-id>
```

The handoff carries the match id, room id, allowed player ids, team assignment, game mode, target round count and expiry time. The match server verifies the HMAC signature, expiry and player membership.

## State

Authenticated client:

```text
STATE
```

Response:

```text
STATE <json>
```

The JSON snapshot contains:

- match/room id
- mode
- status (`active` or `finished`)
- current round
- target rounds
- score by team
- player position
- health/max health
- alive state
- team
- kills/deaths
- connection state

## Movement

```text
MOVE <x> <y> <z>
```

The server validates finite coordinates and rejects a single update that moves more than the configured bootstrap distance limit.

Success:

```text
OK MOVE <player-id> <position-json>
```

Other authenticated players in the same match receive:

```text
EVENT MOVE <player-id> <position-json>
```

## Combat

Bootstrap hit command:

```text
HIT <target-player-id> <damage>
```

Rules currently enforced server-side:

- attacker and target must be in the same match
- attacker and target must be alive
- self-hit is rejected
- friendly fire is disabled
- a single bootstrap hit is capped at 200 damage
- server owns health, kills and deaths

Success:

```text
OK HIT <json>
```

Peers receive:

```text
EVENT HIT <json>
```

The hit JSON includes damage, remaining health, kill flag, round-end flag, winning team and match-end flag.

## Clash Squad round lifecycle

For Clash Squad handoffs the room service currently sets the target to four round wins.

When one team is eliminated:

1. the surviving team receives one point;
2. kills/deaths remain accumulated;
3. if the target score is not reached, the round increments;
4. all players are restored to full health/alive state;
5. players are moved to deterministic team spawn positions;
6. if the target score is reached, the match state becomes `finished`.

## Leaving / liveness

```text
LEAVE
```

marks that player's realtime connection as disconnected.

Authenticated UDP sessions are also considered stale after 90 seconds without traffic. Cleanup marks the player disconnected but keeps match statistics/state available.

## Scope

This protocol exists only as a stable internal contract between tests and the clean-room game backend. A future legacy adapter should translate independently documented client packets into these server operations rather than leaking proprietary packet handling through the gameplay core.
