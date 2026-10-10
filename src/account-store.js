import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataFile = process.env.ACCOUNT_DATA_FILE || '/data/accounts.json';

function emptyState() {
  return { nextUid: 10000001, accounts: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      nextUid: Number(parsed.nextUid || 10000001),
      accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[accounts] load failed:', error.message);
    return emptyState();
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

function sanitizeOpenId(value) {
  const openId = String(value || '').trim();
  if (!openId || openId.length > 160) throw new Error('invalid_open_id');
  return openId;
}

export function getAccountByOpenId(openId) {
  const state = loadState();
  return state.accounts[sanitizeOpenId(openId)] || null;
}

export function getAccountByUid(uid) {
  const target = Number(uid);
  const state = loadState();
  return Object.values(state.accounts).find((account) => Number(account.uid) === target) || null;
}

export function getAccountByToken(token) {
  const value = String(token || '').trim();
  if (!value) return null;
  const state = loadState();
  const now = Date.now();
  return Object.values(state.accounts).find((account) =>
    account.session?.token === value && Number(account.session.expiresAt || 0) > now
  ) || null;
}

export function createAccount(input = {}) {
  const openId = sanitizeOpenId(input.openId);
  const state = loadState();
  if (state.accounts[openId]) return state.accounts[openId];

  const now = Date.now();
  const account = {
    uid: state.nextUid++,
    openId,
    openIdType: String(input.openIdType || ''),
    nickname: String(input.nickname || 'Player').trim().slice(0, 24) || 'Player',
    region: String(input.region || '').trim().slice(0, 16),
    language: String(input.language || '').trim().slice(0, 16),
    deviceId: String(input.deviceId || '').trim().slice(0, 160),
    clientVersion: String(input.clientVersion || '').trim().slice(0, 64),
    level: 1,
    exp: 0,
    coins: 10000,
    gems: 1000,
    rank: 1,
    rankingPoints: 1000,
    clanId: 0,
    role: 1,
    banned: false,
    createdAt: now,
    lastLoginAt: 0,
    session: null
  };

  state.accounts[openId] = account;
  saveState(state);
  return account;
}

export function updateAccount(openId, changes = {}) {
  const key = sanitizeOpenId(openId);
  const state = loadState();
  const account = state.accounts[key];
  if (!account) return null;

  const allowed = ['nickname', 'region', 'language', 'deviceId', 'clientVersion', 'level', 'exp', 'coins', 'gems', 'rank', 'rankingPoints', 'clanId', 'role', 'banned'];
  for (const name of allowed) {
    if (Object.hasOwn(changes, name)) account[name] = changes[name];
  }
  saveState(state);
  return account;
}

export function adjustWalletByUid(uid, delta = {}) {
  const target = Number(uid);
  const state = loadState();
  const account = Object.values(state.accounts).find((candidate) => Number(candidate.uid) === target);
  if (!account) return null;

  const coinsDelta = Math.trunc(Number(delta.coins || 0));
  const gemsDelta = Math.trunc(Number(delta.gems || 0));
  const nextCoins = Number(account.coins || 0) + coinsDelta;
  const nextGems = Number(account.gems || 0) + gemsDelta;
  if (nextCoins < 0) throw new Error('insufficient_coins');
  if (nextGems < 0) throw new Error('insufficient_gems');

  account.coins = nextCoins;
  account.gems = nextGems;
  saveState(state);
  return account;
}

export function addProgressByUid(uid, changes = {}) {
  const target = Number(uid);
  const state = loadState();
  const account = Object.values(state.accounts).find((candidate) => Number(candidate.uid) === target);
  if (!account) return null;

  account.exp = Math.max(0, Number(account.exp || 0) + Math.trunc(Number(changes.exp || 0)));
  account.rankingPoints = Math.max(0, Number(account.rankingPoints || 0) + Math.trunc(Number(changes.rankingPoints || 0)));

  // Clean-room provisional progression: one level every 1000 accumulated XP.
  account.level = Math.max(1, Math.floor(account.exp / 1000) + 1);
  account.rank = Math.max(1, Math.floor(account.rankingPoints / 1000) + 1);
  saveState(state);
  return account;
}

export function issueSession(openId, ttlSeconds = 28800) {
  const key = sanitizeOpenId(openId);
  const state = loadState();
  const account = state.accounts[key];
  if (!account) return null;

  const now = Date.now();
  account.lastLoginAt = now;
  account.session = {
    token: randomBytes(24).toString('hex'),
    createdAt: now,
    expiresAt: now + Math.max(60, Number(ttlSeconds || 28800)) * 1000
  };
  saveState(state);
  return account;
}

export function revokeSession(token) {
  const value = String(token || '').trim();
  if (!value) return false;
  const state = loadState();
  const account = Object.values(state.accounts).find((candidate) => candidate.session?.token === value);
  if (!account) return false;
  account.session = null;
  saveState(state);
  return true;
}

export function accountPublicView(account) {
  if (!account) return null;
  return {
    uid: account.uid,
    nickname: account.nickname,
    region: account.region,
    language: account.language,
    level: account.level,
    exp: account.exp,
    coins: account.coins,
    gems: account.gems,
    rank: account.rank,
    rankingPoints: account.rankingPoints,
    clanId: account.clanId,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt
  };
}
