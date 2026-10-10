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

If the same player authenticates from a new UDP endpoint for the same match, the new endpoint replaces the old realtime session. The old endpoint becomes unauthenticated while gameplay state, health, position, economy, score and statistics remain attached to the player in the match.

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
- credits
- combat weapon/equipment/ammo/consumables
- armor durability
- connection state

## Combat catalog and economy

The current server uses clean-room internal item identifiers. They are deliberately not presented as official legacy item IDs; a future client adapter can map legacy client IDs to these backend entries.

Catalog:

```text
CATALOG
```

Response:

```text
CATALOG <json-array>
```

Current bootstrap catalog includes:

- basic pistol
- SMG
- rifle
- shotgun
- sniper
- level-1 vest
- level-1 helmet
- ammunition packs
- medkit

Every player currently starts with 2,500 round credits, the basic pistol and starter pistol ammunition.

Purchase:

```text
BUY <item-id> [quantity]
```

Examples:

```text
BUY weapon.rifle
BUY ammo.rifle 2
BUY armor.vest1
BUY utility.medkit
```

The server validates the item, quantity, player availability and available credits. Weapons are equipped when purchased; their starter ammunition is added to the player's combat inventory. Equipment and consumables are stored in the match state.

## Server-authoritative weapon fire

```text
FIRE <target-player-id>
```

Unlike the bootstrap `HIT` command, `FIRE` does not accept damage from the client. The server selects damage from the equipped weapon definition, consumes one unit of matching ammunition and applies target armor.

Success:

```text
OK FIRE <json>
```

Peers receive:

```text
EVENT FIRE <json>
```

If a shot is rejected before it becomes valid damage (for example friendly fire or invalid target), the consumed ammunition is restored.

The current clean-room vest model reduces body damage by 20% while vest durability remains. Prevented damage consumes vest durability.

## Consumables

```text
USE utility.medkit
```

The current medkit heals 50 HP, capped at max health. Dead/downed players cannot use it, and using at full health is rejected.

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

## Bootstrap combat

A lower-level test command remains available while gameplay systems are being built:

```text
HIT <target-player-id> <damage>
```

Rules currently enforced server-side:

- attacker and target must be in the same match
- attacker must be alive and not downed
- self-hit is rejected
- friendly fire is disabled
- a single bootstrap hit is capped at 200 damage
- armor mitigation is still server-side
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
2. an elimination grants the attacker 200 credits;
3. members of the winning team receive 1,000 round credits;
4. members of the losing team receive 600 round credits;
5. kills/deaths/revives and remaining economy state stay attached to the player;
6. if the target score is not reached, the round increments;
7. all players are restored to full health/alive/not-downed state;
8. players are moved to deterministic team spawn positions;
9. if the target score is reached, the match state becomes `finished`.

## Automatic result persistence

When the target score is reached, the match server reports the final result to the internal room service through `ROOMS_INTERNAL_URL`.

The callback is authenticated using `MATCH_RESULT_SECRET` (falling back to the handoff secret only for older deployments that do not yet define the new secret).

The room service verifies the room/match identity, stores:

- match id
- winning team
- final score
- per-player team/kills/deaths/revives/remaining credits
- finish/receive timestamps

It then closes the room and releases its members from `playerRoom`. Duplicate result callbacks for the same match are idempotent.

Closed room details can be inspected internally with:

```text
GET /rooms/get?roomId=<room-id>&includeClosed=1
```

## Leaving / liveness

```text
LEAVE
```

marks that player's realtime connection as disconnected.

Authenticated UDP sessions are also considered stale after 90 seconds without traffic. Cleanup marks the player disconnected but keeps match statistics/state available for reconnect.

## Scope

This protocol exists only as a stable internal contract between tests and the clean-room game backend. A future legacy adapter should translate independently documented client packets into these server operations rather than leaking proprietary packet handling through the gameplay core.
