import fs from 'node:fs';
import path from 'node:path';

const dataFile = process.env.SOCIAL_DATA_FILE || '/data/social.json';

function emptyState() {
  return { players: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { players: parsed.players && typeof parsed.players === 'object' ? parsed.players : {} };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[social] load failed:', error.message);
    return emptyState();
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

function key(uid) {
  const value = Number(uid);
  if (!Number.isInteger(value) || value <= 0) throw new Error('invalid_uid');
  return String(value);
}

function normalize(player = {}) {
  return {
    friends: Array.isArray(player.friends) ? [...new Set(player.friends.map(Number))] : [],
    incoming: Array.isArray(player.incoming) ? [...new Set(player.incoming.map(Number))] : [],
    outgoing: Array.isArray(player.outgoing) ? [...new Set(player.outgoing.map(Number))] : [],
    blocked: Array.isArray(player.blocked) ? [...new Set(player.blocked.map(Number))] : [],
    updatedAt: Number(player.updatedAt || 0)
  };
}

function getPair(state, uidA, uidB) {
  const aKey = key(uidA);
  const bKey = key(uidB);
  const a = normalize(state.players[aKey]);
  const b = normalize(state.players[bKey]);
  return { aKey, bKey, a, b };
}

function remove(list, value) {
  return list.filter((entry) => Number(entry) !== Number(value));
}

function add(list, value) {
  const n = Number(value);
  return list.includes(n) ? list : [...list, n];
}

export function getSocial(uid) {
  const state = loadState();
  return publicSocial(normalize(state.players[key(uid)]));
}

export function sendFriendRequest(fromUid, toUid) {
  if (Number(fromUid) === Number(toUid)) throw new Error('cannot_friend_self');
  const state = loadState();
  const { aKey, bKey, a, b } = getPair(state, fromUid, toUid);
  if (a.blocked.includes(Number(toUid)) || b.blocked.includes(Number(fromUid))) throw new Error('friendship_blocked');
  if (a.friends.includes(Number(toUid))) return publicSocial(a);

  a.outgoing = add(a.outgoing, toUid);
  b.incoming = add(b.incoming, fromUid);
  a.updatedAt = b.updatedAt = Date.now();
  state.players[aKey] = a;
  state.players[bKey] = b;
  saveState(state);
  return publicSocial(a);
}

export function acceptFriendRequest(uid, fromUid) {
  const state = loadState();
  const { aKey, bKey, a, b } = getPair(state, uid, fromUid);
  if (!a.incoming.includes(Number(fromUid))) throw new Error('friend_request_not_found');
  if (a.blocked.includes(Number(fromUid)) || b.blocked.includes(Number(uid))) throw new Error('friendship_blocked');

  a.incoming = remove(a.incoming, fromUid);
  b.outgoing = remove(b.outgoing, uid);
  a.friends = add(a.friends, fromUid);
  b.friends = add(b.friends, uid);
  a.updatedAt = b.updatedAt = Date.now();
  state.players[aKey] = a;
  state.players[bKey] = b;
  saveState(state);
  return publicSocial(a);
}

export function rejectFriendRequest(uid, fromUid) {
  const state = loadState();
  const { aKey, bKey, a, b } = getPair(state, uid, fromUid);
  a.incoming = remove(a.incoming, fromUid);
  b.outgoing = remove(b.outgoing, uid);
  a.updatedAt = b.updatedAt = Date.now();
  state.players[aKey] = a;
  state.players[bKey] = b;
  saveState(state);
  return publicSocial(a);
}

export function removeFriend(uid, friendUid) {
  const state = loadState();
  const { aKey, bKey, a, b } = getPair(state, uid, friendUid);
  a.friends = remove(a.friends, friendUid);
  b.friends = remove(b.friends, uid);
  a.updatedAt = b.updatedAt = Date.now();
  state.players[aKey] = a;
  state.players[bKey] = b;
  saveState(state);
  return publicSocial(a);
}

export function blockPlayer(uid, targetUid) {
  if (Number(uid) === Number(targetUid)) throw new Error('cannot_block_self');
  const state = loadState();
  const { aKey, bKey, a, b } = getPair(state, uid, targetUid);

  a.blocked = add(a.blocked, targetUid);
  a.friends = remove(a.friends, targetUid);
  b.friends = remove(b.friends, uid);
  a.incoming = remove(a.incoming, targetUid);
  a.outgoing = remove(a.outgoing, targetUid);
  b.incoming = remove(b.incoming, uid);
  b.outgoing = remove(b.outgoing, uid);
  a.updatedAt = b.updatedAt = Date.now();
  state.players[aKey] = a;
  state.players[bKey] = b;
  saveState(state);
  return publicSocial(a);
}

export function unblockPlayer(uid, targetUid) {
  const state = loadState();
  const aKey = key(uid);
  const a = normalize(state.players[aKey]);
  a.blocked = remove(a.blocked, targetUid);
  a.updatedAt = Date.now();
  state.players[aKey] = a;
  saveState(state);
  return publicSocial(a);
}

export function publicSocial(player) {
  return {
    friends: player.friends || [],
    incoming: player.incoming || [],
    outgoing: player.outgoing || [],
    blocked: player.blocked || [],
    updatedAt: Number(player.updatedAt || 0)
  };
}
