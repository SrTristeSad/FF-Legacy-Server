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
  if (!response.ok || data.ok === false) throw new Error(`${path} -> ${response.status} ${JSON.stringify(data)}`);
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
      reject(new Error(`timeout after ${message.trim()}`));
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

const ownerId = `economy-owner-${randomUUID()}`;
const opponentId = `economy-opponent-${randomUUID()}`;
let roomId = '';
let ownerSocket;
let opponentSocket;

try {
  console.log('[1/9] create economy test room');
  const created = await post('/rooms/create', { playerId: ownerId, nickname: 'EconomyOwner', mode: 'clash_squad', maxPlayers: 2 });
  roomId = created.room.id;
  await post('/rooms/join', { roomId, playerId: opponentId, nickname: 'EconomyOpponent' });
  await post('/rooms/ready', { roomId, playerId: opponentId, ready: true });
  const started = await post('/rooms/start', { roomId, playerId: ownerId });
  const handoff = started.handoff;

  ownerSocket = await makeSocket();
  opponentSocket = await makeSocket();

  console.log('[2/9] authenticate both players');
  await udpRequest(ownerSocket, `HELLO ${handoff.token} ${ownerId}\n`, (text) => text.startsWith('WELCOME '));
  await udpRequest(opponentSocket, `HELLO ${handoff.token} ${opponentId}\n`, (text) => text.startsWith('WELCOME '));

  console.log('[3/9] verify catalog');
  const catalog = parse(await udpRequest(ownerSocket, 'CATALOG\n', (text) => text.startsWith('CATALOG ')), 'CATALOG ');
  if (!catalog.some((item) => item.id === 'weapon.rifle') || !catalog.some((item) => item.id === 'armor.vest1')) {
    throw new Error('combat catalog incomplete');
  }

  console.log('[4/9] buy rifle and extra ammo');
  const rifleBuy = parse(await udpRequest(ownerSocket, 'BUY weapon.rifle\n', (text) => text.startsWith('OK BUY ')), 'OK BUY ');
  if (rifleBuy.credits !== 700 || rifleBuy.loadout?.weapon !== 'weapon.rifle' || rifleBuy.loadout?.ammo?.rifle !== 60) {
    throw new Error(`rifle purchase mismatch: ${JSON.stringify(rifleBuy)}`);
  }
  const ammoBuy = parse(await udpRequest(ownerSocket, 'BUY ammo.rifle 2\n', (text) => text.startsWith('OK BUY ')), 'OK BUY ');
  if (ammoBuy.credits !== 460 || ammoBuy.loadout?.ammo?.rifle !== 120) {
    throw new Error(`ammo purchase mismatch: ${JSON.stringify(ammoBuy)}`);
  }

  console.log('[5/9] opponent buys vest');
  const vestBuy = parse(await udpRequest(opponentSocket, 'BUY armor.vest1\n', (text) => text.startsWith('OK BUY ')), 'OK BUY ');
  if (vestBuy.credits !== 2100 || vestBuy.loadout?.vestDurability !== 100) {
    throw new Error(`vest purchase mismatch: ${JSON.stringify(vestBuy)}`);
  }

  console.log('[6/9] server-authoritative FIRE consumes ammo and applies armor');
  const fire = parse(await udpRequest(ownerSocket, `FIRE ${opponentId}\n`, (text) => text.startsWith('OK FIRE ')), 'OK FIRE ');
  if (fire.weaponId !== 'weapon.rifle' || fire.ammoRemaining !== 119) throw new Error(`fire ammo mismatch: ${JSON.stringify(fire)}`);
  if (fire.hit?.damage !== 32 || fire.hit?.health !== 168) throw new Error(`armor/damage mismatch: ${JSON.stringify(fire)}`);

  console.log('[7/9] verify authoritative state');
  const state = parse(await udpRequest(ownerSocket, 'STATE\n', (text) => text.startsWith('STATE ')), 'STATE ');
  const owner = state.players?.[ownerId];
  const opponent = state.players?.[opponentId];
  if (owner?.credits !== 460 || owner?.loadout?.ammo?.rifle !== 119) throw new Error('owner economy state mismatch');
  if (opponent?.health !== 168 || opponent?.loadout?.vestDurability !== 92) throw new Error('opponent armor state mismatch');

  console.log('[8/9] insufficient funds are rejected');
  const rejected = await udpRequest(ownerSocket, 'BUY weapon.sniper\n', (text) => text.startsWith('ERR '));
  if (rejected !== 'ERR insufficient_credits') throw new Error(`unexpected insufficient-funds reply: ${rejected}`);

  console.log('[9/9] close room');
  await post('/rooms/finish', { roomId, playerId: ownerId });
  console.log('economy smoke test: OK');
} finally {
  ownerSocket?.close();
  opponentSocket?.close();
  if (roomId) {
    try { await post('/rooms/finish', { roomId, playerId: ownerId }); } catch {}
  }
}
