# Internal realtime match protocol

This is the clean-room protocol used to exercise the server while the legacy client adapter is developed. It is intentionally simple and is **not** the proprietary Free Fire wire format.

Default transport: UDP on `GAME_SERVER_PORT` (`10100`).

## Authentication and reconnect

A room start returns a signed handoff token. Each player authenticates its UDP endpoint with:

```text
HELLO <handoff-token> <player-id>
```

Success:

```text
WELCOME <match-id>
```

The handoff carries the match id, room id, allowed player ids, team assignment, game mode, target round count and expiry time. The match server verifies the HMAC signature, expiry and player membership.

If the same player authenticates from a new UDP endpoint for the same match, the new endpoint replaces the old realtime session. The old endpoint becomes unauthenticated while gameplay state, health, position, score and statistics remain attached to the player in the match.

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
- alive/downed state
- team
- kills/deaths/revives
- connection state

## Movement

```text
MOVE <x> <y> <z>
```

The server validates finite coordinates and rejects a single update that moves more than the configured bootstrap distance limit. Dead or downed players cannot use normal movement.

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
- attacker must be alive and not downed
- self-hit is rejected
- friendly fire is disabled
- a single bootstrap hit is capped at 200 damage
- server owns health, kills, deaths and round score
- in Clash Squad team modes, reaching zero HP downs a player when a standing teammate is still available
- hitting an already-down player to zero eliminates that player
- when no standing teammate is available, zero HP eliminates the player immediately

Success:

```text
OK HIT <json>
```

Peers receive:

```text
EVENT HIT <json>
```

The hit JSON includes damage, remaining health, downed/kill flags, round-end flag, winning team and match-end flag.

## Revive

A standing teammate can revive a nearby downed player:

```text
REVIVE <target-player-id>
```

Current clean-room rules:

- reviver and target must be on the same team
- reviver must be alive and not downed
- target must be alive but downed
- target must be within 6 world units
- successful revive restores the target to 50 HP
- revives are counted in the reviver's match statistics

Success:

```text
OK REVIVE <json>
```

Peers receive:

```text
EVENT REVIVE <json>
```

## Clash Squad round lifecycle

For Clash Squad handoffs the room service currently sets the target to four round wins.

When a team has no standing players remaining:

1. the surviving team receives one point;
2. kills/deaths/revives remain accumulated;
3. if the target score is not reached, the round increments;
4. all players are restored to full health/alive/not-downed state;
5. players are moved to deterministic team spawn positions;
6. if the target score is reached, the match state becomes `finished`.

## Leaving / liveness

```text
LEAVE
```

marks that player's realtime connection as disconnected.

Authenticated UDP sessions are also considered stale after 90 seconds without traffic. Cleanup marks the player disconnected but keeps match statistics/state available for reconnect.

## Scope

This protocol exists only as a stable internal contract between tests and the clean-room game backend. A future legacy adapter should translate independently documented client packets into these server operations rather than leaking proprietary packet handling through the gameplay core.
