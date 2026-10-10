import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startHttpService, json, readJson } from './http-common.js';
import { MODE_PRESETS, getModePreset } from './mode-presets.js';

const port = Number(process.env.ROOMS_PORT || 19135);
const dataFile = process.env.ROOMS_DATA_FILE || '/data/rooms.json';
const publicHost = process.env.PUBLIC_HOST || '127.0.0.1';
const gamePort = Number(process.env.GAME_SERVER_PORT || 10100);
const handoffSecret = process.env.MATCH_HANDOFF_SECRET || 'dev-change-me';

const state = loadState();

function emptyState() {
  return { rooms: {}, playerRoom: {}, queues: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      rooms: parsed.rooms || {},
      playerRoom: parsed.playerRoom || {},
      queues: parsed.queues || {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[rooms] load failed:', error.message);
    return emptyState();
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

function fail(status, code, details) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
}

function now() {
  return new Date().toISOString();
}

function playerId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 80) fail(400, 'invalid_player_id');
  return id;
}

function nickname(value) {
  return String(value || 'Player').trim().slice(0, 24) || 'Player';
}

function modeName(value) {
  const valueString = String(value || '').trim();
  if (!getModePreset(valueString)) fail(400, 'unsupported_mode');
  return valueString;
}

function passwordHash(password) {
  if (!password) return null;
  return createHash('sha256').update(String(password)).digest('hex');
}

function passwordMatches(room, password) {
  if (!room.passwordHash) return true;
  const expected = Buffer.from(room.passwordHash, 'hex');
  const actualHash = passwordHash(password);
  if (!actualHash) return false;
  const actual = Buffer.from(actualHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(6);
    let code = '';
    for (const byte of bytes) code += alphabet[byte % alphabet.length];
    const taken = Object.values(state.rooms).some((room) => room.code === code && room.status !== 'closed');
    if (!taken) return code;
  }
  fail(503, 'room_code_exhausted');
}

function publicRoom(room) {
  return {
    id: room.id,
    code: room.code,
    mode: room.mode,
    modeInfo: getModePreset(room.mode),
    status: room.status,
    ownerId: room.ownerId,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    private: room.private,
    passwordProtected: Boolean(room.passwordHash),
    members: room.members.map(({ playerId, nickname, ready, joinedAt, team, slot }) => ({
      playerId,
      nickname,
      ready,
      joinedAt,
      team,
      slot
    })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    match: room.match ? {
      id: room.match.id,
      host: room.match.host,
      port: room.match.port,
      expiresAt: room.match.expiresAt
    } : null
  };
}

function findRoom(input = {}, allowClosed = false) {
  let room = null;
  if (input.roomId) room = state.rooms[String(input.roomId)];
  if (!room && input.code) {
    const code = String(input.code).trim().toUpperCase();
    room = Object.values(state.rooms).find((candidate) => candidate.code === code);
  }
  if (!room || (!allowClosed && room.status === 'closed')) fail(404, 'room_not_found');
  return room;
}

function removeFromQueues(id) {
  let removed = false;
  for (const mode of Object.keys(state.queues)) {
    const before = state.queues[mode].length;
    state.queues[mode] = state.queues[mode].filter((entry) => entry.playerId !== id);
    if (state.queues[mode].length !== before) removed = true;
  }
  return removed;
}

function assignTeams(room) {
  const preset = getModePreset(room.mode);
  const teams = Math.max(1, Number(preset?.teams || 1));
  if (teams === 1) {
    room.members.forEach((member, index) => {
      member.team = 1;
      member.slot = index;
    });
    return;
  }

  const teamSize = Math.ceil(room.maxPlayers / teams);
  room.members.forEach((member, index) => {
    member.team = Math.min(teams, Math.floor(index / teamSize) + 1);
    member.slot = index % teamSize;
  });
}

function createRoom({ id, name, mode, privateRoom = false, password = null, maxPlayers = null, source = 'manual' }) {
  if (state.playerRoom[id]) fail(409, 'player_already_in_room');
  removeFromQueues(id);

  const preset = getModePreset(mode);
  const requested = Number(maxPlayers || preset.maxPlayers);
  const effectiveMax = Math.max(1, Math.min(requested, preset.maxPlayers));
  const timestamp = now();
  const room = {
    id: randomUUID(),
    code: inviteCode(),
    mode,
    source,
    status: 'waiting',
    ownerId: id,
    maxPlayers: effectiveMax,
    minPlayers: Math.min(preset.minPlayers, effectiveMax),
    private: Boolean(privateRoom),
    passwordHash: passwordHash(password),
    members: [{ playerId: id, nickname: name, ready: false, joinedAt: timestamp, team: 1, slot: 0 }],
    createdAt: timestamp,
    updatedAt: timestamp,
    match: null
  };

  state.rooms[room.id] = room;
  state.playerRoom[id] = room.id;
  assignTeams(room);
  return room;
}

function joinRoom(room, { id, name, password = null }) {
  if (room.status !== 'waiting') fail(409, 'room_not_joinable');
  if (!passwordMatches(room, password)) fail(403, 'wrong_room_password');
  if (room.members.some((member) => member.playerId === id)) return room;
  if (room.members.length >= room.maxPlayers) fail(409, 'room_full');
  if (state.playerRoom[id] && state.playerRoom[id] !== room.id) fail(409, 'player_already_in_room');

  removeFromQueues(id);
  room.members.push({ playerId: id, nickname: name, ready: false, joinedAt: now(), team: 1, slot: 0 });
  state.playerRoom[id] = room.id;
  room.updatedAt = now();
  assignTeams(room);
  return room;
}

function leaveRoom(room, id) {
  const index = room.members.findIndex((member) => member.playerId === id);
  if (index < 0) fail(404, 'player_not_in_room');

  room.members.splice(index, 1);
  delete state.playerRoom[id];

  if (!room.members.length) room.status = 'closed';
  else if (room.ownerId === id) room.ownerId = room.members[0].playerId;

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
  if (room.ownerId !== actorId) fail(403, 'owner_required');
  if (room.status !== 'waiting') fail(409, 'room_not_waiting');
  if (room.members.length < room.minPlayers && !force) fail(409, 'not_enough_players');
  if (!force && room.members.some((member) => member.playerId !== room.ownerId && !member.ready)) {
    fail(409, 'players_not_ready');
  }

  const matchId = randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const players = room.members.map((member) => member.playerId);
  const token = signHandoff({ matchId, roomId: room.id, players, exp: expiresAt });

  room.status = 'in_match';
  room.updatedAt = now();
  room.match = { id: matchId, host: publicHost, port: gamePort, token, expiresAt };
  return room;
}

function finishRoom(room, actorId) {
  if (room.ownerId !== actorId) fail(403, 'owner_required');
  if (room.status !== 'in_match') fail(409, 'room_not_in_match');

  for (const member of room.members) delete state.playerRoom[member.playerId];
  room.status = 'closed';
  room.updatedAt = now();
  return room;
}

function queuePosition(mode, id) {
  const index = (state.queues[mode] || []).findIndex((entry) => entry.playerId === id);
  return index < 0 ? null : index + 1;
}

function processQueue(mode) {
  const preset = getModePreset(mode);
  const queue = state.queues[mode] || [];
  const created = [];

  while (queue.length >= preset.maxPlayers) {
    const group = queue.splice(0, preset.maxPlayers);
    const first = group.shift();
    const room = createRoom({ id: first.playerId, name: first.nickname, mode, source: 'matchmaking' });
    for (const member of group) joinRoom(room, { id: member.playerId, name: member.nickname });
    for (const member of room.members) member.ready = true;
    startRoom(room, room.ownerId, { force: true });
    created.push(room);
  }

  state.queues[mode] = queue;
  return created;
}

const routes = {
  'GET /modes': async (_req, res) => {
    json(res, 200, { ok: true, modes: MODE_PRESETS });
  },

  'GET /rooms': async (_req, res, url) => {
    const requestedMode = url.searchParams.get('mode');
    const rooms = Object.values(state.rooms)
      .filter((room) => room.status === 'waiting' && !room.private)
      .filter((room) => !requestedMode || room.mode === requestedMode)
      .map(publicRoom);
    json(res, 200, { ok: true, rooms });
  },

  'GET /rooms/get': async (_req, res, url) => {
    const room = findRoom({ roomId: url.searchParams.get('roomId'), code: url.searchParams.get('code') });
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/create': async (req, res) => {
    const body = await readJson(req);
    const room = createRoom({
      id: playerId(body.playerId),
      name: nickname(body.nickname),
      mode: modeName(body.mode),
      privateRoom: body.private,
      password: body.password,
      maxPlayers: body.maxPlayers
    });
    saveState();
    json(res, 201, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/join': async (req, res) => {
    const body = await readJson(req);
    const room = findRoom(body);
    joinRoom(room, { id: playerId(body.playerId), name: nickname(body.nickname), password: body.password });
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/leave': async (req, res) => {
    const body = await readJson(req);
    const id = playerId(body.playerId);
    const selector = body.roomId || body.code ? body : { roomId: state.playerRoom[id] };
    const room = findRoom(selector);
    leaveRoom(room, id);
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/ready': async (req, res) => {
    const body = await readJson(req);
    const id = playerId(body.playerId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[id], code: body.code });
    const member = room.members.find((candidate) => candidate.playerId === id);
    if (!member) fail(404, 'player_not_in_room');
    member.ready = body.ready !== false;
    room.updatedAt = now();
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/kick': async (req, res) => {
    const body = await readJson(req);
    const actorId = playerId(body.actorId);
    const targetId = playerId(body.targetId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[actorId], code: body.code });
    if (room.ownerId !== actorId) fail(403, 'owner_required');
    if (targetId === actorId) fail(400, 'owner_cannot_kick_self');
    leaveRoom(room, targetId);
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /rooms/start': async (req, res) => {
    const body = await readJson(req);
    const id = playerId(body.playerId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[id], code: body.code });
    startRoom(room, id);
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room), handoff: room.match });
  },

  'POST /rooms/finish': async (req, res) => {
    const body = await readJson(req);
    const id = playerId(body.playerId);
    const room = findRoom({ roomId: body.roomId || state.playerRoom[id], code: body.code });
    finishRoom(room, id);
    saveState();
    json(res, 200, { ok: true, room: publicRoom(room) });
  },

  'POST /queue/join': async (req, res) => {
    const body = await readJson(req);
    const id = playerId(body.playerId);
    const mode = modeName(body.mode);
    if (state.playerRoom[id]) fail(409, 'player_already_in_room');

    removeFromQueues(id);
    state.queues[mode] ||= [];
    state.queues[mode].push({ playerId: id, nickname: nickname(body.nickname), queuedAt: now() });
    const matches = processQueue(mode);
    saveState();

    const roomId = state.playerRoom[id];
    json(res, 200, {
      ok: true,
      matched: Boolean(roomId),
      position: roomId ? null : queuePosition(mode, id),
      room: roomId ? publicRoom(state.rooms[roomId]) : null,
      matchesCreated: matches.length
    });
  },

  'POST /queue/leave': async (req, res) => {
    const body = await readJson(req);
    const removed = removeFromQueues(playerId(body.playerId));
    saveState();
    json(res, 200, { ok: true, removed });
  },

  'GET /queue/status': async (_req, res, url) => {
    const id = playerId(url.searchParams.get('playerId'));
    const roomId = state.playerRoom[id];
    if (roomId && state.rooms[roomId]) {
      return json(res, 200, { ok: true, matched: true, room: publicRoom(state.rooms[roomId]) });
    }

    for (const mode of Object.keys(state.queues)) {
      const position = queuePosition(mode, id);
      if (position) return json(res, 200, { ok: true, matched: false, queued: true, mode, position });
    }

    json(res, 200, { ok: true, matched: false, queued: false });
  }
};

startHttpService({ name: 'rooms', port, routes });

process.on('SIGTERM', () => {
  try { saveState(); } catch {}
  process.exit(0);
});
