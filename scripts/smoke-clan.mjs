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
  const openId = `smoke-clan-${randomUUID()}`;
  await post(`${loginBase}/register`, { openId, nickname, region: 'BR' });
  const login = await post(`${loginBase}/login`, { openId });
  if (!login.token || !login.account?.uid) throw new Error('account login incomplete');
  return login;
}

console.log('[1/7] create clan test accounts');
const owner = await makeAccount('ClanOwner');
const member = await makeAccount('ClanMember');

console.log('[2/7] create clan');
const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
const created = await post(`${mainBase}/clans/create`, {
  name: `Legacy ${suffix}`,
  tag: suffix
}, owner.token);
if (!created.clan?.id || created.clan.ownerUid !== owner.account.uid) throw new Error('clan create failed');

console.log('[3/7] second account joins');
const joined = await post(`${mainBase}/clans/join`, { clanId: created.clan.id }, member.token);
if (joined.clan?.memberCount !== 2) throw new Error('clan join failed');

console.log('[4/7] promote member to officer');
const promoted = await post(`${mainBase}/clans/role`, {
  targetUid: member.account.uid,
  role: 'officer'
}, owner.token);
if (!promoted.clan?.members?.some((entry) => entry.uid === member.account.uid && entry.role === 'officer')) {
  throw new Error('clan role update failed');
}

console.log('[5/7] transfer ownership');
const transferred = await post(`${mainBase}/clans/transfer`, { targetUid: member.account.uid }, owner.token);
if (transferred.clan?.ownerUid !== member.account.uid) throw new Error('ownership transfer failed');

console.log('[6/7] new owner disbands clan');
const disbanded = await post(`${mainBase}/clans/disband`, {}, member.token);
if (!disbanded.result?.disbanded || disbanded.result.membersReleased !== 2) throw new Error('clan disband failed');

console.log('[7/7] both accounts released');
const ownerMine = await get(`${mainBase}/clan/mine`, owner.token);
const memberMine = await get(`${mainBase}/clan/mine`, member.token);
if (ownerMine.clan !== null || memberMine.clan !== null) throw new Error('clanId cleanup failed');

await post(`${loginBase}/logout`, {}, owner.token);
await post(`${loginBase}/logout`, {}, member.token);
console.log('clan smoke test: OK');
