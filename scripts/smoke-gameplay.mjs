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

function udpWait(socket, accept, label = 'UDP event', timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`UDP timeout waiting for ${label}`));
    }, timeoutMs);

    function onMessage(buffer) {
      const text = buffer.toString('utf8').trim();
      if (!accept(text)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(text);
    }

    socket.on('message', onMessage);
  });
}

function udpRequest(socket, message, accept, timeoutMs = 3000) {
  const response = udpWait(socket, accept, `reply to ${message.trim()}`, timeoutMs);
  socket.send(Buffer.from(message), gamePort, '127.0.0.1');
  return response;
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
let reconnectSocket;

try {
  console.log('[1/11] create 1v1 Clash Squad room');
  const created = await post('/rooms/create', {
    playerId: ownerId,
    nickname: 'GameplayOwner',
    mode: 'clash_squad',
    maxPlayers: 2
  });
  roomId = created.room.id;

  console.log('[2/11] join opponent and ready');
  await post('/rooms/join', {
    roomId,
    playerId: opponentId,
    nickname: 'GameplayOpponent'
  });
  await post('/rooms/ready', { roomId, playerId: opponentId, ready: true });

  console.log('[3/11] start room and obtain handoff');
  const started = await post('/rooms/start', { roomId, playerId: ownerId });
  const handoff = started.handoff;
  if (!handoff?.token || !handoff?.id) throw new Error('handoff missing');

  ownerSocket = await makeSocket();
  opponentSocket = await makeSocket();

  console.log('[4/11] authenticate both UDP clients');
  const welcomeA = await udpRequest(ownerSocket, `HELLO ${handoff.token} ${ownerId}\n`, (text) => text.startsWith('WELCOME '));
  if (welcomeA !== `WELCOME ${handoff.id}`) throw new Error(`owner welcome mismatch: ${welcomeA}`);

  const joinEvent = udpWait(ownerSocket, (text) => text === `EVENT JOIN ${opponentId}`, 'opponent join event');
  const welcomeB = await udpRequest(opponentSocket, `HELLO ${handoff.token} ${opponentId}\n`, (text) => text.startsWith('WELCOME '));
  if (welcomeB !== `WELCOME ${handoff.id}`) throw new Error(`opponent welcome mismatch: ${welcomeB}`);
  await joinEvent;

  console.log('[5/11] reconnect owner and invalidate old socket');
  reconnectSocket = await makeSocket();
  const rewelcome = await udpRequest(reconnectSocket, `HELLO ${handoff.token} ${ownerId}\n`, (text) => text.startsWith('WELCOME '));
  if (rewelcome !== `WELCOME ${handoff.id}`) throw new Error(`reconnect welcome mismatch: ${rewelcome}`);
  const oldSocketReply = await udpRequest(ownerSocket, 'STATE\n', (text) => text.startsWith('ERR '));
  if (oldSocketReply !== 'ERR authentication_required') throw new Error(`old socket remained authenticated: ${oldSocketReply}`);
  ownerSocket.close();
  ownerSocket = reconnectSocket;
  reconnectSocket = undefined;

  console.log('[6/11] verify initial match state and opposing teams');
  const stateText = await udpRequest(ownerSocket, 'STATE\n', (text) => text.startsWith('STATE '));
  const initial = parseJsonReply(stateText, 'STATE ');
  const owner = initial.players?.[ownerId];
  const opponent = initial.players?.[opponentId];
  if (!owner || !opponent) throw new Error('players missing from match state');
  if (owner.team === opponent.team) throw new Error(`players must be on opposing teams: ${owner.team}`);
  if (initial.round !== 1 || initial.status !== 'active') throw new Error('initial round state invalid');
  if (initial.targetRounds !== 4) throw new Error(`expected first-to-4 series, got ${initial.targetRounds}`);

  console.log('[7/11] move owner and verify peer broadcast');
  const moveEventPromise = udpWait(opponentSocket, (text) => text.startsWith(`EVENT MOVE ${ownerId} `), 'move broadcast');
  const moveText = await udpRequest(ownerSocket, 'MOVE 5 0 3\n', (text) => text.startsWith('OK MOVE '));
  const moved = parseJsonReply(moveText, `OK MOVE ${ownerId} `);
  if (moved.x !== 5 || moved.z !== 3) throw new Error(`move not applied: ${moveText}`);
  await moveEventPromise;

  console.log('[8/11] play four winning rounds and verify hit broadcasts');
  for (let round = 1; round <= 4; round += 1) {
    const hitEventPromise = udpWait(opponentSocket, (text) => text.startsWith('EVENT HIT '), `hit broadcast round ${round}`);
    const hitText = await udpRequest(ownerSocket, `HIT ${opponentId} 200\n`, (text) => text.startsWith('OK HIT '));
    const hit = parseJsonReply(hitText, 'OK HIT ');
    if (!hit.killed || !hit.roundEnded) throw new Error(`round ${round} did not end: ${hitText}`);
    if (round < 4 && hit.matchEnded) throw new Error(`match ended too early on round ${round}`);
    if (round === 4 && !hit.matchEnded) throw new Error('match did not end at four wins');
    await hitEventPromise;
  }

  console.log('[9/11] verify final match state');
  const finalText = await udpRequest(ownerSocket, 'STATE\n', (text) => text.startsWith('STATE '));
  const finalState = parseJsonReply(finalText, 'STATE ');
  if (finalState.status !== 'finished') throw new Error(`match not finished: ${finalText}`);
  if (Number(finalState.score?.[String(owner.team)] || 0) !== 4) throw new Error(`final score invalid: ${finalText}`);
  if (finalState.players?.[ownerId]?.kills !== 4 || finalState.players?.[opponentId]?.deaths !== 4) {
    throw new Error(`kill/death counters invalid: ${finalText}`);
  }

  console.log('[10/11] reject gameplay after match finish');
  const rejectedMove = await udpRequest(ownerSocket, 'MOVE 6 0 3\n', (text) => text.startsWith('ERR '));
  if (rejectedMove !== 'ERR match_not_active') throw new Error(`unexpected post-match reply: ${rejectedMove}`);

  console.log('[11/11] close room');
  await post('/rooms/finish', { roomId, playerId: ownerId });
  console.log('gameplay smoke test: OK');
} finally {
  ownerSocket?.close();
  opponentSocket?.close();
  reconnectSocket?.close();
  if (roomId) {
    try { await post('/rooms/finish', { roomId, playerId: ownerId }); } catch {}
  }
}
