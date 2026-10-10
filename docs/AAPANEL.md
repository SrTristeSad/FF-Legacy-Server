# aaPanel deployment

This project is designed so aaPanel/Nginx can remain responsible for websites and TLS while Docker runs the backend services.

## 1. Requirements

Install Docker and Docker Compose support on the VPS. In aaPanel, keep Nginx/Apache on the normal web ports.

## 2. Clone and initialize

```bash
cd /www/wwwroot
git clone https://github.com/SrTristeSad/FF-Legacy-Server.git
cd FF-Legacy-Server
chmod +x scripts/*.sh
./scripts/setup.sh
```

Edit `.env` before the first start. At minimum change the PostgreSQL password and set the public host you intend to use.

## 3. Start

```bash
./scripts/start.sh
./scripts/status.sh
```

## 4. aaPanel reverse proxies

Create three sites or proxy hosts and point them to the loopback services:

- live host -> `http://127.0.0.1:19134`
- login host -> `http://127.0.0.1:19132`
- main host -> `http://127.0.0.1:19133`

TLS can be managed normally by aaPanel.

## 5. TCP and UDP

The default Compose file intentionally binds the TCP gateway and UDP match service to `127.0.0.1` too. This makes a fresh installation safe by default.

When you are ready to test an external client, change only these two mappings in `docker-compose.yml` from `127.0.0.1:` to the desired public bind address and allow the corresponding ports in the VPS firewall:

- gateway: `8084/TCP`
- match: `10100/UDP`

Do not expose PostgreSQL or Redis publicly.

## 6. Updating

```bash
git pull
./scripts/start.sh
```

## 7. Important compatibility note

The infrastructure is functional, but the wire protocol implemented here is currently only a clean-room bootstrap. A legacy client will not complete the original game's login/lobby flow until those packet formats are independently documented and implemented.
