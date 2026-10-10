import { randomUUID } from 'node:crypto';

const loginBase = `http://127.0.0.1:${process.env.LOGIN_PORT || 19132}`;
const mainBase = `http://127.0.0.1:${process.env.MAIN_PORT || 19133}`;

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(`${options.method || 'GET'} ${url} -> ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function post(url, body, token = '') {
  return request(url, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });
}

function get(url, token) {
  return request(url, { headers: { authorization: `Bearer ${token}` } });
}

async function makeAccount(nickname) {
  const openId = `smoke-lobby-${randomUUID()}`;
  await post(`${loginBase}/register`, { openId, nickname, region: 'BR', language: 'pt-br' });
  const login = await post(`${loginBase}/login`, { openId });
  if (!login.token || !login.account?.uid) throw new Error('account login incomplete');
  return login;
}

console.log('[1/7] create two accounts');
const a = await makeAccount('LobbyA');
const b = await makeAccount('LobbyB');

console.log('[2/7] starter inventory');
const inventory = await get(`${mainBase}/inventory`, a.token);
if (!inventory.inventory?.claimedStarter) throw new Error('starter inventory not claimed');
if (!inventory.inventory.items?.some((item) => item.itemId === 'char.default')) throw new Error('starter character missing');

console.log('[3/7] update loadout');
const loadout = await post(`${mainBase}/loadout`, { emotes: ['emote.hello'] }, a.token);
if (loadout.loadout?.emotes?.length !== 1 || loadout.loadout.emotes[0] !== 'emote.hello') {
  throw new Error('loadout update failed');
}

console.log('[4/7] send friend request');
await post(`${mainBase}/friends/request`, { targetUid: b.account.uid }, a.token);

console.log('[5/7] accept friend request');
await post(`${mainBase}/friends/accept`, { fromUid: a.account.uid }, b.token);
const socialA = await get(`${mainBase}/social`, a.token);
if (!socialA.social?.friends?.some((entry) => Number(entry.uid) === Number(b.account.uid))) {
  throw new Error('friendship not established');
}

console.log('[6/7] block removes friendship, then unblock');
await post(`${mainBase}/social/block`, { targetUid: b.account.uid }, a.token);
let social = await get(`${mainBase}/social`, a.token);
if (!social.social?.blocked?.some((entry) => Number(entry.uid) === Number(b.account.uid))) throw new Error('block failed');
if (social.social?.friends?.some((entry) => Number(entry.uid) === Number(b.account.uid))) throw new Error('blocked player still friend');
await post(`${mainBase}/social/unblock`, { targetUid: b.account.uid }, a.token);

console.log('[7/7] lobby summary');
const lobby = await get(`${mainBase}/lobby`, a.token);
if (!lobby.inventory?.loadout || typeof lobby.social?.friendCount !== 'number') throw new Error('lobby summary incomplete');

await post(`${loginBase}/logout`, {}, a.token);
await post(`${loginBase}/logout`, {}, b.token);
console.log('lobby smoke test: OK');
