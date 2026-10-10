import { startHttpService, readJson, json } from './http-common.js';
import {
  accountPublicView,
  authenticateLocalAccount,
  createAccount,
  createLocalAccount,
  createOrGetGuestAccount,
  getAccountByOpenId,
  getAccountByToken,
  issueSession,
  revokeSession,
  updateAccount
} from './account-store.js';

const port = Number(process.env.LOGIN_PORT || 19132);
const sessionTtl = Number(process.env.SESSION_TTL_SEC || 28800);

function publicServices(req) {
  const host = process.env.PUBLIC_HOST || (req.headers.host || '127.0.0.1').split(':')[0];
  return {
    live: { host, port: Number(process.env.LIVE_PORT || 19134), protocol: 'http' },
    main: { host, port: Number(process.env.MAIN_PORT || 19133), protocol: 'http' },
    rooms: { host, port: Number(process.env.ROOMS_PORT || 19135), protocol: 'http' },
    gateway: { host, port: Number(process.env.TCP_PORT || 8084), protocol: 'tcp' },
    match: { host, port: Number(process.env.GAME_SERVER_PORT || 10100), protocol: 'udp' }
  };
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function sessionPayload(req, account) {
  return {
    ok: true,
    token: account.session.token,
    ttl: sessionTtl,
    expiresAt: account.session.expiresAt,
    account: accountPublicView(account),
    services: publicServices(req),
    compatibility: 'clean-room-session-layer',
    gameVersion: process.env.GAME_VERSION || 'unknown'
  };
}

function ensureAllowed(account, res) {
  if (!account) {
    json(res, 401, { ok: false, error: 'invalid_credentials' });
    return false;
  }
  if (account.banned) {
    json(res, 403, { ok: false, error: 'account_banned' });
    return false;
  }
  return true;
}

startHttpService({
  name: 'login',
  port,
  routes: {
    // Clean-room compatibility endpoints used by the existing smoke tests.
    'POST /register': async (req, res) => {
      const body = await readJson(req);
      const account = createAccount({
        openId: body.openId,
        openIdType: body.openIdType,
        nickname: body.nickname,
        region: body.region,
        language: body.language,
        deviceId: body.deviceId,
        clientVersion: body.clientVersion
      });
      json(res, 201, { ok: true, account: accountPublicView(account) });
    },

    'POST /login': async (req, res) => {
      const body = await readJson(req);
      const openId = String(body.openId || '').trim();
      const existing = openId ? getAccountByOpenId(openId) : null;
      if (!existing) return json(res, 404, { ok: false, error: 'account_not_registered' });
      if (!ensureAllowed(existing, res)) return;

      updateAccount(openId, {
        ...(body.deviceId ? { deviceId: String(body.deviceId) } : {}),
        ...(body.clientVersion ? { clientVersion: String(body.clientVersion) } : {}),
        ...(body.language ? { language: String(body.language) } : {})
      });
      const account = issueSession(openId, sessionTtl);
      json(res, 200, sessionPayload(req, account));
    },

    // Native FF Legacy accounts: no Facebook/Google/Garena dependency.
    'POST /auth/register': async (req, res) => {
      const body = await readJson(req);
      const created = createLocalAccount({
        username: body.username,
        password: body.password,
        nickname: body.nickname,
        region: body.region,
        language: body.language,
        deviceId: body.deviceId,
        clientVersion: body.clientVersion
      });
      const account = issueSession(created.openId, sessionTtl);
      json(res, 201, sessionPayload(req, account));
    },

    'POST /auth/login': async (req, res) => {
      const body = await readJson(req);
      const existing = authenticateLocalAccount(body.username, body.password);
      if (!ensureAllowed(existing, res)) return;
      updateAccount(existing.openId, {
        ...(body.deviceId ? { deviceId: String(body.deviceId) } : {}),
        ...(body.clientVersion ? { clientVersion: String(body.clientVersion) } : {}),
        ...(body.language ? { language: String(body.language) } : {})
      });
      const account = issueSession(existing.openId, sessionTtl);
      json(res, 200, sessionPayload(req, account));
    },

    'POST /auth/guest': async (req, res) => {
      const body = await readJson(req);
      const existing = createOrGetGuestAccount({
        deviceId: body.deviceId,
        nickname: body.nickname,
        region: body.region || 'BR',
        language: body.language || 'pt-BR',
        clientVersion: body.clientVersion
      });
      if (!ensureAllowed(existing, res)) return;
      const account = issueSession(existing.openId, sessionTtl);
      json(res, 200, sessionPayload(req, account));
    },

    'POST /logout': async (req, res) => {
      const body = await readJson(req);
      const token = bearer(req) || String(body.token || '');
      json(res, 200, { ok: true, revoked: revokeSession(token) });
    },

    'GET /session': async (req, res, url) => {
      const token = bearer(req) || String(url.searchParams.get('token') || '');
      const account = getAccountByToken(token);
      if (!account) return json(res, 401, { ok: false, error: 'invalid_session' });
      json(res, 200, {
        ok: true,
        account: accountPublicView(account),
        expiresAt: account.session.expiresAt
      });
    }
  }
});
