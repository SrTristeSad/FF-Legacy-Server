import { startHttpService, json } from './http-common.js';

const port = Number(process.env.MAIN_PORT || 19133);
const host = process.env.PUBLIC_HOST || '127.0.0.1';

const services = () => ({
  live: { host, port: Number(process.env.LIVE_PORT || 19134), protocol: 'http' },
  login: { host, port: Number(process.env.LOGIN_PORT || 19132), protocol: 'http' },
  rooms: { host, port: Number(process.env.ROOMS_PORT || 19135), protocol: 'http' },
  gateway: { host, port: Number(process.env.TCP_PORT || 8084), protocol: 'tcp' },
  match: { host, port: Number(process.env.GAME_SERVER_PORT || 10100), protocol: 'udp' }
});

startHttpService({
  name: 'main',
  port,
  routes: {
    'GET /bootstrap': async (_req, res) => {
      json(res, 200, {
        ok: true,
        gameVersion: process.env.GAME_VERSION || 'unknown',
        compatibility: 'clean-room-bootstrap',
        services: services()
      });
    },

    'GET /services': async (_req, res) => {
      json(res, 200, { ok: true, services: services() });
    },

    'GET /profile': async (_req, res, url) => {
      const uid = String(url.searchParams.get('uid') || '10000001').slice(0, 80);
      const nickname = String(url.searchParams.get('nickname') || 'LegacyGuest').slice(0, 24);
      json(res, 200, {
        ok: true,
        uid,
        nickname,
        level: 1,
        roomService: services().rooms,
        note: 'Bootstrap profile until legacy profile packets are independently documented.'
      });
    }
  }
});
