import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

const roomsPort = Number(process.env.ROOMS_PORT || 19135);
const gamePort = Number(process.env.GAME_SERVER_PORT || 10100);
const roomsBase = `http://127.0.0.1:${roomsPort}`;

async function post(path, body) {
  const response = await fetch(`${roomsBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(`${path} -> ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const playerId = `smoke-${randomUUID()}`;

console.log('[1/5] create solo room');
const created = await post('/rooms/create', {
  playerId,
  nickname: 'SmokePlayer',
  mode: 'casual_solo'
});

console.log('[2/5] start room and obtain signed handoff');
const started = await post('/rooms/start', {
  roomId: created.room.id,
  playerId
});

const handoff = started.handoff;
if (!handoff?.token || !handoff?.id) throw new Error('missing handoff');

console.log('[3/5] authenticate against UDP match server');
const socket = dgram.createSocket('udp4');
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('UDP match server timeout'));
  }, 3000);

  socket.once('error', (error) => {
    clearTimeout(timer);
    socket.close();
    reject(error);
  });

  socket.once('message', (message) => {
    clearTimeout(timer);
    const text = message.toString('utf8').trim();
    socket.close();
    resolve(text);
  });

  socket.send(Buffer.from(`HELLO ${handoff.token} ${playerId}\n`), gamePort, '127.0.0.1');
});

console.log(`[udp] ${result}`);
if (result !== `WELCOME ${handoff.id}`) {
  throw new Error(`unexpected UDP response: ${result}`);
}

console.log('[4/5] finish room');
await post('/rooms/finish', { roomId: created.room.id, playerId });

console.log('[5/5] end-to-end handoff verified');
console.log('match smoke test: OK');
