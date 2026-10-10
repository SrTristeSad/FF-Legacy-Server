import { startHttpService, json, readJson } from './http-common.js';
import { accountPublicView, getAccountByToken } from './account-store.js';
import { claimStarter, getCatalog, getInventory, updateLoadout } from './inventory-store.js';

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

function mapInventoryError(error) {
  const code = String(error?.message || 'inventory_error');
  const statusByCode = {
    invalid_uid: 400,
    unknown_item: 404,
    wrong_item_type: 400,
    item_not_owned: 409
  };
  error.status = statusByCode[code] || 400;
  error.code = code;
  return error;
}

function lobbyView(account) {
  const inventory = claimStarter(account.uid);
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
    inventory: {
      itemCount: inventory.items.length,
      loadout: inventory.loadout
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
    },

    'GET /inventory/catalog': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      json(res, 200, { ok: true, catalog: getCatalog() });
    },

    'GET /inventory': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      json(res, 200, { ok: true, inventory: claimStarter(account.uid) });
    },

    'POST /inventory/claim-starter': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      json(res, 200, { ok: true, inventory: claimStarter(account.uid) });
    },

    'POST /loadout': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      const body = await readJson(req);
      try {
        const inventory = updateLoadout(account.uid, body);
        json(res, 200, { ok: true, loadout: inventory.loadout, inventory });
      } catch (error) {
        throw mapInventoryError(error);
      }
    },

    'GET /loadout': async (req, res) => {
      const account = requireAccount(req, res);
      if (!account) return;
      const inventory = getInventory(account.uid);
      json(res, 200, { ok: true, loadout: inventory.loadout });
    }
  }
});
