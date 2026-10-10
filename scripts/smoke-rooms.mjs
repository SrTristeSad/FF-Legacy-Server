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

console.log('[1/6] health');
await request('/health');

console.log('[2/6] create clash squad room');
const created = await post('/rooms/create', {
  playerId: 'smoke-owner',
  nickname: 'Owner',
  mode: 'clash_squad'
});
const roomId = created.room.id;
console.log(`room=${roomId} code=${created.room.code}`);

console.log('[3/6] join second player');
await post('/rooms/join', {
  roomId,
  playerId: 'smoke-player-2',
  nickname: 'Player2'
});

console.log('[4/6] second player ready');
await post('/rooms/ready', {
  roomId,
  playerId: 'smoke-player-2',
  ready: true
});

console.log('[5/6] start room and get UDP handoff');
const started = await post('/rooms/start', {
  roomId,
  playerId: 'smoke-owner'
});
if (!started.handoff?.host || !started.handoff?.port || !started.handoff?.token) {
  throw new Error('handoff is incomplete');
}
console.log(`match=${started.handoff.id} ${started.handoff.host}:${started.handoff.port}`);

console.log('[6/6] list modes');
const modes = await request('/modes');
if (!modes.modes?.clash_squad || !modes.modes?.custom) throw new Error('expected modes missing');

console.log('rooms smoke test: OK');
