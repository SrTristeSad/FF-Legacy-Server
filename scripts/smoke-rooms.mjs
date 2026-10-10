import { randomUUID } from 'node:crypto';

const port = process.env.ROOMS_PORT || 19135;
const base = `http://127.0.0.1:${port}`;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function post(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

const runId = randomUUID().slice(0, 8);
const ownerId = `smoke-owner-${runId}`;
const player2Id = `smoke-player-2-${runId}`;

console.log('[1/7] health');
await request('/health');

console.log('[2/7] create clash squad room');
const created = await post('/rooms/create', {
  playerId: ownerId,
  nickname: 'Owner',
  mode: 'clash_squad'
});
const roomId = created.room.id;
console.log(`room=${roomId} code=${created.room.code}`);

console.log('[3/7] join second player');
await post('/rooms/join', {
  roomId,
  playerId: player2Id,
  nickname: 'Player2'
});

console.log('[4/7] second player ready');
await post('/rooms/ready', {
  roomId,
  playerId: player2Id,
  ready: true
});

console.log('[5/7] start room and get UDP handoff');
const started = await post('/rooms/start', {
  roomId,
  playerId: ownerId
});
if (!started.handoff?.host || !started.handoff?.port || !started.handoff?.token) {
  throw new Error('handoff is incomplete');
}
console.log(`match=${started.handoff.id} ${started.handoff.host}:${started.handoff.port}`);

console.log('[6/7] verify historical mode catalog');
const modes = await request('/modes');
for (const mode of ['clash_squad', 'custom', 'lone_wolf', 'lone_wolf_strikeout', 'creation_workshop', 'parkour', 'pet_ludo']) {
  if (!modes.modes?.[mode]) throw new Error(`expected mode missing: ${mode}`);
}

console.log('[7/7] finish room and release players');
await post('/rooms/finish', { roomId, playerId: ownerId });

console.log('rooms smoke test: OK');
