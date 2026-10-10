import crypto from 'node:crypto';
import { startHttpService, readBody, json } from './http-common.js';

const port = Number(process.env.LOGIN_PORT || 19132);

startHttpService({
  name: 'login',
  port,
  routes: {
    'POST /login': async (req, res) => {
      const body = await readBody(req);
      const session = crypto.randomUUID();
      const host = process.env.PUBLIC_HOST || '127.0.0.1';

      json(res, 200, {
        ok: true,
        session,
        receivedBytes: body.length,
        compatibility: 'clean-room-bootstrap',
        gameVersion: process.env.GAME_VERSION || 'unknown',
        services: {
          live: { host, port: Number(process.env.LIVE_PORT || 19134), protocol: 'http' },
          main: { host, port: Number(process.env.MAIN_PORT || 19133), protocol: 'http' },
          rooms: { host, port: Number(process.env.ROOMS_PORT || 19135), protocol: 'http' },
          gateway: { host, port: Number(process.env.TCP_PORT || 8084), protocol: 'tcp' },
          match: { host, port: Number(process.env.GAME_SERVER_PORT || 10100), protocol: 'udp' }
        }
      });
    }
  }
});
