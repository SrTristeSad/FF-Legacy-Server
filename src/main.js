import { startHttpService, json } from './http-common.js';
import { accountPublicView, getAccountByToken } from './account-store.js';

const port = Number(process.env.MAIN_PORT || 19133);
const host = process.env.PUBLIC_HOST || '127.0.0.1';

const services = () => ({
  live: { host, port: Number(process.env.LIVE_PORT || 19134), protocol: 'http' },
  login: { host, port: Number(process.env.LOGIN_PORT || 19132), protocol: 'http' },
  rooms: { host, port: Number(process.env.ROOMS_PORT || 19135), protocol: 'http' },
  gateway: { host, port: Number(process.env.TCP_PORT || 8084), protocol: 'tcp' },
  match: { host, port: Number(process.env.GAME_SERVER_PORT || 10100), protocol: 'udp' }
});

function bearer(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireAccount(req, res) {
  const account = getAccountByToken(bearer(req));
  if (!account) {
    json(res, 401, { ok: false, error: 'invalid_session' });
    return null;
  }
  if (account.banned) {
    json(res, 403, { ok: false, error: 'account_banned' });
    return null;
  }
  return account;
}

function lobbyView(account) {
  return {
    account: accountPublicView(account),
    wallet: {
      coins: Number(account.coins || 0),
      gems: Number(account.gems || 0)
    },
    ranking: {
      rank: Number(account.rank || 1),
      points: Number(account.rankingPoints || 0),
      showRank: true
    },
    clan: {
      id: Number(account.clanId || 0)
    },
    queue: {
      position: 0,
      waitSeconds: 0
    },
    realtime: {
      notificationChannel: `${host}:${Number(process.env.TCP_PORT || 8084)}`,
      gameServer: `${host}:${Number(process.env.GAME_SERVER_PORT || 10100)}`
    },
    serverTime: Math.floor(Date.now() / 1000)
  };
}

startHttpService({
  name: 'main',
  port,
  routes: {
    'GET /bootstrap': async (req, res) => {
      const account = getAccountByToken(bearer(req));
      json(res, 200, {
        ok: true,
        gameVersion: process.env.GAME_VERSION || 'unknown',
        compatibility: 'clean-room-session-layer',
        services: services(),
        ...(account ? { account: accountPublicView(account) } : {})
      });
    },

    'GET /services': async (_req, res) => {
      json(res, 200, { ok: true, services: services() });
    },

    'GET /profile': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      json(res, 200, { ok: true, profile: accountPublicView(account) });
    },

    'GET /lobby': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      json(res, 200, { ok: true, ...lobbyView(account) });
    }
  }
});
