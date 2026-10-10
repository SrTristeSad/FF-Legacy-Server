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

console.log('[1/9] create two accounts');
const a = await makeAccount('LobbyA');
const b = await makeAccount('LobbyB');

console.log('[2/9] starter inventory');
const inventory = await get(`${mainBase}/inventory`, a.token);
if (!inventory.inventory?.claimedStarter) throw new Error('starter inventory not claimed');
if (!inventory.inventory.items?.some((item) => item.itemId === 'char.default')) throw new Error('starter character missing');

console.log('[3/9] buy cosmetic from shop');
const shop = await get(`${mainBase}/shop`, a.token);
if (!shop.offers?.some((offer) => offer.offerId === 'offer.head.cap')) throw new Error('expected shop offer missing');
const purchase = await post(`${mainBase}/shop/purchase`, { offerId: 'offer.head.cap' }, a.token);
if (!purchase.inventory?.items?.some((item) => item.itemId === 'outfit.head.cap')) throw new Error('purchased item missing');
if (Number(purchase.wallet?.coins) >= Number(a.account.coins)) throw new Error('wallet was not charged');

console.log('[4/9] equip purchased item and emote selection');
const loadout = await post(`${mainBase}/loadout`, {
  head: 'outfit.head.cap',
  emotes: ['emote.hello']
}, a.token);
if (loadout.loadout?.head !== 'outfit.head.cap') throw new Error('purchased head item was not equipped');
if (loadout.loadout?.emotes?.length !== 1 || loadout.loadout.emotes[0] !== 'emote.hello') throw new Error('emote loadout update failed');

console.log('[5/9] purchase receipt history');
const history = await get(`${mainBase}/shop/history`, a.token);
if (!history.receipts?.some((receipt) => receipt.offerId === 'offer.head.cap')) throw new Error('purchase receipt missing');

console.log('[6/9] send friend request');
await post(`${mainBase}/friends/request`, { targetUid: b.account.uid }, a.token);

console.log('[7/9] accept friend request');
await post(`${mainBase}/friends/accept`, { fromUid: a.account.uid }, b.token);
const socialA = await get(`${mainBase}/social`, a.token);
if (!socialA.social?.friends?.some((entry) => Number(entry.uid) === Number(b.account.uid))) throw new Error('friendship not established');

console.log('[8/9] block removes friendship, then unblock');
await post(`${mainBase}/social/block`, { targetUid: b.account.uid }, a.token);
let social = await get(`${mainBase}/social`, a.token);
if (!social.social?.blocked?.some((entry) => Number(entry.uid) === Number(b.account.uid))) throw new Error('block failed');
if (social.social?.friends?.some((entry) => Number(entry.uid) === Number(b.account.uid))) throw new Error('blocked player still friend');
await post(`${mainBase}/social/unblock`, { targetUid: b.account.uid }, a.token);

console.log('[9/9] lobby summary');
const lobby = await get(`${mainBase}/lobby`, a.token);
if (!lobby.inventory?.loadout || typeof lobby.social?.friendCount !== 'number') throw new Error('lobby summary incomplete');
if (!Number.isInteger(lobby.shop?.offerCount) || lobby.shop.offerCount <= 0) throw new Error('shop summary missing');

await post(`${loginBase}/logout`, {}, a.token);
await post(`${loginBase}/logout`, {}, b.token);
console.log('lobby smoke test: OK');
