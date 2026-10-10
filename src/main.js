import { startHttpService, json } from './http-common.js';

const port = Number(process.env.MAIN_PORT || 19133);

startHttpService({
  name: 'main',
  port,
  routes: {
    'GET /profile': async (_req, res) => {
      json(res, 200, {
        ok: true,
        uid: 10000001,
        nickname: 'LegacyGuest',
        level: 1,
        note: 'Placeholder profile until the legacy protocol is implemented.'
      });
    }
  }
});
