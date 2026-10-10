import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startHttpService, json, readJson } from './http-common.js';

const port = Number(process.env.ROOMS_PORT || 19135);
const dataFile = process.env.ROOMS_DATA_FILE || '/data/rooms.json';
const publicHost = process.env.PUBLIC_HOST || '127.0.0.1';
const gamePort = Number(process.env.GAME_SERVER_PORT || 10100);
const handoffSecret = process.env.MATCH_HANDOFF_SECRET || 'dev-change-me';

const MODE_PRESETS = Object.freeze({
  casual_solo: { maxPlayers: 1, minPlayers: 1, teams: 1 },
  casual_duo: { maxPlayers: 2, minPlayers: 2, teams: 1 },
  casual_squad: { maxPlayers: 4, minPlayers: 2, teams: 1 },
  ranked_solo: { maxPlayers: 1, minPlayers: 1, teams: 1 },
  ranked_duo: { maxPlayers: 2, minPlayers: 2, teams: 1 },
  ranked_squad: { maxPlayers: 4, minPlayers: 4, teams: 1 },
  clash_squad: { maxPlayers: 8, minPlayers: 2, teams: 2 },
  clash_squad_ranked: { maxPlayers: 8, minPlayers: 8, teams: 2 },
  custom: { maxPlayers: 48, minPlayers: 1, teams: 2 },
  training: { maxPlayers: 24, minPlayers: 1, teams: 1 }
});

const state = loadState();

function blankState() {
  return { rooms: {}, playerRoom: {}, queues: {} };
}

function loadState() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      rooms: parsed.rooms || {},
      playerRoom: parsed.playerRoom || {},
      queues: parsed.queues || {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[rooms] failed loading state:', error.message);
    return blankState();
  }
}

function saveState() {
  const dir = path.dirname(dataFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

function now() {
  return new Date().toISOString();
}

function cleanPlayerId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 80) throw httpError(400, 'invalid_player_id');
  return id;
}

function cleanNickname(value) {
  const nickname = String(value ?? 'Player').trim().slice(0, 24);
  return nickname || 'Player';
}

function cleanMode(value) {
  const mode = String(value ?? '').trim();
  if (!MODE_PRESETS[mode]) throw httpError(400, 'unsupported_mode');
  return mode;
}

function httpError(status, code, details) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function hashPassword(password) {
  if (!password) return null;
  return createHash('sha256').update(String(password)).digest('hex');
}

function passwordMatches(room, candidate) {
  if (!room.passwordHash) return true;
  const expected = Buffer.from(room.passwordHash, 'hex');
  const actual = Buffer.from(hashPassword(candidate) || '', 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(6);
    let code = '';
    for (const byte of bytes) code += alphabet[byte % alphabet.length];
    if (!Object.values(state.rooms).some((room) => room.code === code && room.status !== 'closed')) return code;
  }
  throw httpError(503, 'room_code_exhausted');
}

function publicRoom(room) {
  return {
    id: room.id,
    code: room.code,
    mode: room.mode,
    status: room.status,
    ownerId: room.ownerId,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    private: room.private,
    passwordProtected: Boolean(room.passwordHash),
    members: room.members.map(({ playerId, nickname, ready, joinedAt, team, slot }) => ({
      playerId, nickname, ready, joinedAt, team, slot
    })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    match: room.match ? { id: room.match.id, host: room.match.host, port: room.match.port } : null
  };
}

function findRoom(input = {}) {
  let room = null;
  if (input.roomId) room = state.rooms[String(input.roomId)];
  if (!room && input.code) {
    const code = String(input.code).trim().toUpperCase();
    room = Object.values(state.rooms).find((candidate) => candidate.code === code);
  }
  if (!room || room.status === 'closed') throw httpError(404, 'room_not_found');
  return room;
}

function removePlayerFromQueues(playerId) {
  let changed = false;
  for (const [mode, queue] of Object.entries(state.queues)) {
    const before = queue.length;
    state.queues[mode] = queue.filter((entry) => entry.playerId !== playerId);
    if (before !== state.queues[mode].length) changed = true;
  }
  return changed;
}

function assignTeams(room) {
  const teams = MODE_PRESETS[room.mode]?.teams || 1;
  if (teams <= 1) {
    room.members.forEach((member, index) => {
      member.team = 1;
      member.slot = index;
    });
    return;
  }

  const perTeam = Math.ceil(room.maxPlayers / teams);
  room.members.forEach((member, index) => {
    member.team = Math.min(teams, Math.floor(index / perTeam) + 1);
    member.slot = index % perTeam;
  });
}

function createRoom({ playerId, nickname, mode, private: isPrivate = false, password = null, maxPlayers = null, source = 'manual' }) {
  if (state.playerRoom[playerId]) throw httpError(409, 'player_already_in_room');
  removePlayerFromQueues(playerId);

  const preset = MODE_PRESETS[mode];
  const requestedMax = Number(maxPlayers || preset.maxPlayers);
  const effectiveMax = Math.max(1, Math.min(requestedMax, preset.maxPlayers));
  const timestamp = now();
  const room = {
    id: randomUUID(),
    code: makeCode(),
    mode,
    source,
    status: 'waiting',
    ownerId: playerId,
    maxPlayers: effectiveMax,
    minPlayers: Math.min(preset.minPlayers, effectiveMax),
    private: Boolean(isPrivate),
    passwordHash: hashPassword(password),
    members: [{ playerId, nickname, ready: false, joinedAt: timestamp, team: 1, slot: 0 }],
    createdAt: timestamp,
    updatedAt: timestamp,
    match: null
  };

  state.rooms[room.id] = room;
  state.playerRoom[playerId] = room.id;
  assignTeams(room);
  return room;
}

function joinRoom(room, { playerId, nickname, password = null }) {
  if (room.status !== 'waiting') throw httpError(409, 'room_not_joinable');
  if (room.members.length >= room.maxPlayers) throw httpError(409, 'room_full');
  if (!passwordMatches(room, password)) throw httpError(403, 'wrong_room_password');

  const currentRoomId = state.playerRoom[playerId];
  if (currentRoomId && currentRoomId !== room.id) throw httpError(409, 'player_already_in_room');
  if (room.members.some((member) => member.playerId === playerId)) return room;

  removePlayerFromQueues(playerId);
  room.members.push({ playerId, nickname, ready: false, joinedAt: now(), team: 1, slot: 0 });
  state.playerRoom[playerId] = room.id;
  room.updatedAt = now();
  assignTeams(room);
  return room;
}

function leaveRoom(room, playerId) {
  const index = room.members.findIndex((member) => member.playerId === playerId);
  if (index < 0) throw httpError(404, 'player_not_in_room');

  room.members.splice(index, 1);
  delete state.playerRoom[playerId];

  if (room.members.length === 0) {
    room.status = 'closed';
  } else if (room.ownerId === playerId) {
    room.ownerId = room.members[0].playerId;
  }

  room.updatedAt = now();
  assignTeams(room);
  return room;
}

function signHandoff(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', handoffSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function startRoom(room, actorId, { force = false } = {}) {
  if (room.ownerId !== actorId) throw httpError(403, 'owner_required');
  if (room.status !== 'waiting') throw httpError(409, 'room_not_waiting');
  if (room.members.length < room.minPlayers && !force) throw httpError(409, 'not_enough_players');
  if (!force && room.members.some((member) => member.playerId !== room.ownerId && !member.ready)) {
    throw httpError(409, 'players_not_ready');
  }

  const matchId = randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const token = signHandoff({ matchId, roomId: room.id, players: room.members.map((member) => member.playerId), exp: expiresAt });

  room.status = 'in_match';
  room.updatedAt = now();
  room.match = {
    id: matchId,
    host: publicHost,
    port: gamePort,
    token,
    expiresAt
  };

  return room;
}

function processQueue(mode) {
  const preset = MODE_PRESETS[mode];
  const queue = state.queues[mode] || [];
  const created = [];

  while (queue.length >= preset.maxPlayers) {
    const group = queue.splice(0, preset.maxPlayers);
    const first = group.shift();
    const room = createRoom({ ...first, mode, source: 'matchmaking' });
    for (const player of group) joinRoom(room, player);
    for (const member of room.members) member.ready = true;
    startRoom(room, room.ownerId, { force: true });
    created.push(room);
  }

  state.queues[mode] = queue;
  return created;
}

function queuePosition(mode, playerId) {
  const queue = state.queues[mode] || [];
  const index = queue.findIndex((entry) => entry.playerId === playerId);
  return index < 0 ? null : index + 1;
}

const routes = {
  'GET /modes': async (_req, res) => {
    json(res, 200, { ok: true, modes: MODE_PRESETS });
  },

  'GET /rooms': async (_req, res, url) => {
    const mode = url.searchParams.get('mode');
    const rooms = Object.values(state.rooms)
      .filter((room) => room.status === 'waiting' && !room.private)
      .filter((room) => !mode || room.mode === mode)
      .map(publicRoom);
    json(res, 200, { ok: true, rooms });
  },

  'GET /rooms/get': async (_req, res, url) => {
    const room = findRoom({ roomId: url.searchParams.get('roomId'), code: url.searchParams.get('code') });
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/create': async (req, res) => {
    const body = await readJson(req);
    const playerId = cleanPlayerId(body.playerId);
    const room = createRoom({
      playerId,
      nickname: cleanNickname(body.nickname),
      mode: cleanMode(body.mode),
      private: body.private,
      password: body.password,
      maxPlayers: body.maxPlayers
    });
    saveState();
    json(res, 201, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/join': async (req, res) => {
    const body = await readJson(req);
    const playerId = cleanPlayerId(body.playerId);
    const room = findRoom(body);
    joinRoom(room, { playerId, nickname: cleanNickname(body.nickname), password: body.password });
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/leave': async (req, res) => {
    const body = await readJson(req);
    const playerId = cleanPlayerId(body.playerId);
    const room = findRoom(body.roomId || body.code ? body : { roomId: state.playerRoom[playerId] });
    leaveRoom(room, playerId);
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/ready': async (req, res) => {
    const body = await readJson(req);
    const playerId = cleanPlayerId(body.playerId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[playerId], code: body.code });
    const member = room.members.find((candidate) => candidate.playerId === playerId);
    if (!member) throw httpError(404, 'player_not_in_room');
    member.ready = body.ready !== false;
    room.updatedAt = now();
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/kick': async (req, res) => {
    const body = await readJson(req);
    const actorId = cleanPlayerId(body.actorId);
    const targetId = cleanPlayerId(body.targetId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[actorId], code: body.code });
    if (room.ownerId !== actorId) throw httpError(403, 'owner_required');
    if (targetId === actorId) throw httpError(400, 'owner_cannot_kick_self');
    leaveRoom(room, targetId);
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/start': async (req, res) => {
    const body = await readJson(req);
    const actorId = cleanPlayerId(body.playerId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[actorId], code: body.code });
    startRoom(room, actorId);
    saveState();
    json(res, 200, {
      ok: true,
      room: publicRoom(room),
      handoff: room.match
    });
  },

  'POST /queue/join': async (req, res) => {
    const body = await readJson(req);
    const playerId = cleanPlayerId(body.playerId);
    const mode = cleanMode(body.mode);
    if (state.playerRoom[playerId]) throw httpError(409, 'player_already_in_room');
    removePlayerFromQueues(playerId);
    state.queues[mode] ||= [];
    state.queues[mode].push({ playerId, nickname: cleanNickname(body.nickname), queuedAt: now() });
    const matches = processQueue(mode);
    saveState();

    const roomId = state.playerRoom[playerId];
    json(res, 200, {
      ok: true,
      matched: Boolean(roomId),
      position: roomId ? null : queuePosition(mode, playerId),
      room: roomId ? publicRoom(state.rooms[roomId]) : null,
      matchesCreated: matches.length
    });
  },

  'POST /queue/leave': async (req, res) => {
    const body = await readJson(req);
    const playerId = cleanPlayerId(body.playerId);
    const removed = removePlayerFromQueues(playerId);
    saveState();
    json(res, 200, { ok: true, removed });
  },

  'GET /queue/status': async (_req, res, url) => {
    const playerId = cleanPlayerId(url.searchParams.get('playerId'));
    const roomId = state.playerRoom[playerId];
    if (roomId && state.rooms[roomId]) {
      return json(res, 200, { ok: true, matched: true, room: publicRoom(state.rooms[roomId]) });
    }

    for (const mode of Object.keys(state.queues)) {
      const position = queuePosition(mode, playerId);
      if (position) return json(res, 200, { ok: true, matched: false, mode, position });
    }
    json(res, 200, { ok: true, matched: false, queued: false });
  }
};

startHttpService({ name: 'rooms', port, routes });

process.on('SIGTERM', () => {
  try { saveState(); } catch {}
  process.exit(0);
});
