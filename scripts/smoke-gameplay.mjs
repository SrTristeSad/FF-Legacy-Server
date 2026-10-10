import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

const roomsBase = `http://127.0.0.1:${process.env.ROOMS_PORT || 19135}`;
const gamePort = Number(process.env.GAME_SERVER_PORT || 10100);

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

function makeSocket() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => resolve(socket));
  });
}

function udpRequest(socket, message, accept, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`UDP timeout waiting after: ${message.trim()}`));
    }, timeoutMs);

    function onMessage(buffer) {
      const text = buffer.toString('utf8').trim();
      if (!accept(text)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(text);
    }

    socket.on('message', onMessage);
    socket.send(Buffer.from(message), gamePort, '127.0.0.1', (error) => {
      if (!error) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      reject(error);
    });
  });
}

function parseJsonReply(text, prefix) {
  if (!text.startsWith(prefix)) throw new Error(`expected ${prefix}, got ${text}`);
  return JSON.parse(text.slice(prefix.length));
}

const ownerId = `game-owner-${randomUUID()}`;
const opponentId = `game-opponent-${randomUUID()}`;
let roomId = '';
let ownerSocket;
let opponentSocket;

try {
  console.log('[1/9] create 1v1 Clash Squad room');
  const created = await post('/rooms/create', {
    playerId: ownerId,
    nickname: 'GameplayOwner',
    mode: 'clash_squad',
    maxPlayers: 2
  });
  roomId = created.room.id;

  console.log('[2/9] join opponent and ready');
  await post('/rooms/join', {
    roomId,
    playerId: opponentId,
    nickname: 'GameplayOpponent'
  });
  await post('/rooms/ready', { roomId, playerId: opponentId, ready: true });

  console.log('[3/9] start room and obtain handoff');
  const started = await post('/rooms/start', { roomId, playerId: ownerId });
  const handoff = started.handoff;
  if (!handoff?.token || !handoff?.id) throw new Error('handoff missing');

  ownerSocket = await makeSocket();
  opponentSocket = await makeSocket();

  console.log('[4/9] authenticate both UDP clients');
  const welcomeA = await udpRequest(
    ownerSocket,
    `HELLO ${handoff.token} ${ownerId}\n`,
    (text) => text.startsWith('WELCOME ')
  );
  if (welcomeA !== `WELCOME ${handoff.id}`) throw new Error(`owner welcome mismatch: ${welcomeA}`);

  const welcomeB = await udpRequest(
    opponentSocket,
    `HELLO ${handoff.token} ${opponentId}\n`,
    (text) => text.startsWith('WELCOME ')
  );
  if (welcomeB !== `WELCOME ${handoff.id}`) throw new Error(`opponent welcome mismatch: ${welcomeB}`);

  console.log('[5/9] verify initial match state and opposing teams');
  const stateText = await udpRequest(ownerSocket, 'STATE\n', (text) => text.startsWith('STATE '));
  const initial = parseJsonReply(stateText, 'STATE ');
  const owner = initial.players?.[ownerId];
  const opponent = initial.players?.[opponentId];
  if (!owner || !opponent) throw new Error('players missing from match state');
  if (owner.team === opponent.team) throw new Error(`players must be on opposing teams: ${owner.team}`);
  if (initial.round !== 1 || initial.status !== 'active') throw new Error('initial round state invalid');

  console.log('[6/9] move owner');
  const moveText = await udpRequest(ownerSocket, 'MOVE 5 0 3\n', (text) => text.startsWith('OK MOVE '));
  const moved = parseJsonReply(moveText, `OK MOVE ${ownerId} `);
  if (moved.x !== 5 || moved.z !== 3) throw new Error(`move not applied: ${moveText}`);

  console.log('[7/9] eliminate opponent and close round');
  const hitText = await udpRequest(
    ownerSocket,
    `HIT ${opponentId} 200\n`,
    (text) => text.startsWith('OK HIT ')
  );
  const hit = parseJsonReply(hitText, 'OK HIT ');
  if (!hit.killed || !hit.roundEnded || hit.matchEnded) throw new Error(`unexpected hit result: ${hitText}`);

  console.log('[8/9] verify score and round reset');
  const afterText = await udpRequest(ownerSocket, 'STATE\n', (text) => text.startsWith('STATE '));
  const after = parseJsonReply(afterText, 'STATE ');
  if (after.round !== 2 || after.status !== 'active') throw new Error(`round did not advance: ${afterText}`);
  if (Number(after.score?.[String(owner.team)] || 0) !== 1) throw new Error(`score did not increment: ${afterText}`);
  if (!after.players?.[opponentId]?.alive || after.players?.[opponentId]?.health !== 200) {
    throw new Error(`opponent was not reset for next round: ${afterText}`);
  }

  console.log('[9/9] finish room');
  await post('/rooms/finish', { roomId, playerId: ownerId });
  console.log('gameplay smoke test: OK');
} finally {
  ownerSocket?.close();
  opponentSocket?.close();
  if (roomId) {
    try { await post('/rooms/finish', { roomId, playerId: ownerId }); } catch {}
  }
}
