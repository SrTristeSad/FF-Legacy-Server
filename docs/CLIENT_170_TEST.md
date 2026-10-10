# Free Fire 1.70.0 client bootstrap test

This guide is for testing the legacy 1.70.0 client against this clean-room server. It does not describe bypassing the original service's anti-cheat or account protections.

## Experimental patched APK

The test build changes only the Unity bootstrap URL in `assets/bin/Data/level0`:

- original: `https://freefiremobile-a.akamaihd.net/sbt/ABHotUpdates/`
- test: `http://freefiremobile-a.akamaihd.net//sbt/ABHotUpdates/`

The replacement has the same byte length so the serialized Unity asset layout is not shifted. The APK is then signed with a development key, so it is not install-compatible with an already installed official build signed by Garena.

No native library, anti-cheat library or gameplay binary is patched by this bootstrap build.

## Server configuration

For a test VPS, set `.env` to the public IPv4/hostname the emulator can reach:

```env
GAME_VERSION=1.70.0
PUBLIC_HOST=YOUR_VPS_IP
BIND_HOST=0.0.0.0
```

Optional explicit bootstrap URLs:

```env
CLIENT_LOGIN_URL=http://YOUR_VPS_IP:19132/
CLIENT_CDN_URL=http://YOUR_VPS_IP:19134/live/ABHotUpdates/
```

Then restart:

```bash
docker compose up -d --build
sh scripts/smoke-all.sh
```

The live service exposes:

- `GET /ver.php`
- `GET /sbt/ABHotUpdates/android/1.70.0/versioninfo`
- `GET /sbt/ABHotUpdates/android/1.70.0/fileinfo`
- equivalent `/live/ABHotUpdates/...` metadata paths

`fileinfo` is intentionally empty for now, so the clean-room server does not advertise replacement asset bundles during the first connectivity test.

## Temporary test-only ports

When `BIND_HOST=0.0.0.0`, the following become reachable from outside the VPS:

- `19134/TCP` live/bootstrap
- `19132/TCP` login
- `19133/TCP` main
- `19135/TCP` rooms API
- `8084/TCP` realtime gateway
- `10100/UDP` match server

Restrict them with the VPS firewall to your own test IP whenever possible. Return `BIND_HOST` to `127.0.0.1` after testing.

## Hostname routing

The patched bootstrap still uses the historical hostname `freefiremobile-a.akamaihd.net`; a test emulator/network therefore needs that hostname to resolve to your VPS during the experiment.

The 1.70.0 generation may also query legacy live/login names before or after bootstrap. During a controlled test, watch DNS/server logs rather than guessing which names the exact build uses. Do not redirect unrelated traffic or use the test setup for the official live service.

## First success criterion

Do not expect a playable match immediately. The first milestone is:

```text
client starts
  -> reaches our live/bootstrap service
  -> GET /ver.php succeeds
  -> receives our server_url/cdn_url
  -> attempts the legacy login flow against our server
```

Once that request appears in the server logs we can map the exact 1.70.0 login packet and implement the clean-room adapter against the already working account/lobby backend.
