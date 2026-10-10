import { startHttpService, json } from './http-common.js';

const port = Number(process.env.LIVE_PORT || 19134);

startHttpService({
  name: 'live',
  port,
  routes: {
    'GET /status': async (_req, res) => {
      json(res, 200, {
        ok: true,
        online: true,
        gameVersion: process.env.GAME_VERSION || '1.70.4'
      });
    }
  }
});
