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
      json(res, 200, {
        ok: true,
        session,
        receivedBytes: body.length,
        compatibility: 'clean-room-placeholder',
        gateway: {
          host: process.env.PUBLIC_HOST || '127.0.0.1',
          port: Number(process.env.TCP_PORT || 8084)
        },
        match: {
          host: process.env.PUBLIC_HOST || '127.0.0.1',
          port: Number(process.env.GAME_SERVER_PORT || 10100)
        }
      });
    }
  }
});
