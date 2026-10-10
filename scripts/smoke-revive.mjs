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
      reject(new Error(`UDP timeout after ${message.trim()}`));
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

function parse(text, prefix) {
  if (!text.startsWith(prefix)) throw new Error(`expected ${prefix}, got ${text}`);
  return JSON.parse(text.slice(prefix.length));
}

const ids = {
  owner: `revive-owner-${randomUUID()}`,
  teammate: `revive-mate-${randomUUID()}`,
  enemy: `revive-enemy-${randomUUID()}`,
  enemyMate: `revive-enemy-mate-${randomUUID()}`
};

const sockets = {};
let roomId = '';

try {
  console.log('[1/8] create 2v2 Clash Squad room');
  const created = await post('/rooms/create', {
    playerId: ids.owner,
    nickname: 'ReviveOwner',
    mode: 'clash_squad',
    maxPlayers: 4
  });
  roomId = created.room.id;

  console.log('[2/8] fill room and ready players');
  for (const [key, nickname] of [
    ['teammate', 'ReviveMate'],
    ['enemy', 'ReviveEnemy'],
    ['enemyMate', 'ReviveEnemyMate']
  ]) {
    await post('/rooms/join', { roomId, playerId: ids[key], nickname });
    await post('/rooms/ready', { roomId, playerId: ids[key], ready: true });
  }

  console.log('[3/8] start match and authenticate three actors');
  const started = await post('/rooms/start', { roomId, playerId: ids.owner });
  const handoff = started.handoff;
  if (!handoff?.token) throw new Error('missing handoff token');

  for (const key of ['owner', 'teammate', 'enemy']) {
    sockets[key] = await makeSocket();
    const welcome = await udpRequest(
      sockets[key],
      `HELLO ${handoff.token} ${ids[key]}\n`,
      (text) => text.startsWith('WELCOME ')
    );
    if (welcome !== `WELCOME ${handoff.id}`) throw new Error(`${key} welcome mismatch: ${welcome}`);
  }

  console.log('[4/8] verify team topology');
  const initialText = await udpRequest(sockets.owner, 'STATE\n', (text) => text.startsWith('STATE '));
  const initial = parse(initialText, 'STATE ');
  if (initial.players?.[ids.owner]?.team !== initial.players?.[ids.teammate]?.team) throw new Error('owner and teammate split across teams');
  if (initial.players?.[ids.owner]?.team === initial.players?.[ids.enemy]?.team) throw new Error('enemy assigned to owner team');

  console.log('[5/8] enemy downs owner without ending round');
  const downText = await udpRequest(
    sockets.enemy,
    `HIT ${ids.owner} 200\n`,
    (text) => text.startsWith('OK HIT ')
  );
  const down = parse(downText, 'OK HIT ');
  if (!down.downed || down.killed || down.roundEnded) throw new Error(`unexpected down result: ${downText}`);

  const downStateText = await udpRequest(sockets.teammate, 'STATE\n', (text) => text.startsWith('STATE '));
  const downState = parse(downStateText, 'STATE ');
  if (!downState.players?.[ids.owner]?.downed || downState.players?.[ids.owner]?.health !== 1) {
    throw new Error(`owner not downed in state: ${downStateText}`);
  }

  console.log('[6/8] downed player cannot move');
  const deniedMove = await udpRequest(sockets.owner, 'MOVE 1 0 0\n', (text) => text.startsWith('ERR '));
  if (deniedMove !== 'ERR player_downed') throw new Error(`unexpected downed movement reply: ${deniedMove}`);

  console.log('[7/8] teammate revives owner');
  const reviveText = await udpRequest(
    sockets.teammate,
    `REVIVE ${ids.owner}\n`,
    (text) => text.startsWith('OK REVIVE ')
  );
  const revived = parse(reviveText, 'OK REVIVE ');
  if (revived.health !== 50 || revived.targetId !== ids.owner) throw new Error(`unexpected revive: ${reviveText}`);

  const restoredText = await udpRequest(sockets.owner, 'STATE\n', (text) => text.startsWith('STATE '));
  const restored = parse(restoredText, 'STATE ');
  if (restored.players?.[ids.owner]?.downed || restored.players?.[ids.owner]?.health !== 50) {
    throw new Error(`owner not restored after revive: ${restoredText}`);
  }
  if (restored.players?.[ids.teammate]?.revives !== 1) throw new Error('revive counter not recorded');

  console.log('[8/8] close room');
  await post('/rooms/finish', { roomId, playerId: ids.owner });
  console.log('revive smoke test: OK');
} finally {
  for (const socket of Object.values(sockets)) socket?.close();
  if (roomId) {
    try { await post('/rooms/finish', { roomId, playerId: ids.owner }); } catch {}
  }
}
