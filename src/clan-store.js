import fs from 'node:fs';
import path from 'node:path';
import { getAccountByUid, updateAccount } from './account-store.js';

const dataFile = process.env.CLAN_DATA_FILE || '/data/clans.json';
const MAX_MEMBERS = 50;

function emptyState() {
  return { nextClanId: 1001, clans: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      nextClanId: Number(parsed.nextClanId || 1001),
      clans: parsed.clans && typeof parsed.clans === 'object' ? parsed.clans : {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[clans] load failed:', error.message);
    return emptyState();
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 24) throw new Error('invalid_clan_name');
  return name;
}

function cleanTag(value) {
  const tag = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (tag.length < 2 || tag.length > 6) throw new Error('invalid_clan_tag');
  return tag;
}

function requireClan(state, clanId) {
  const clan = state.clans[String(Number(clanId))];
  if (!clan) throw new Error('clan_not_found');
  return clan;
}

function memberOf(clan, uid) {
  return clan.members.find((member) => Number(member.uid) === Number(uid)) || null;
}

function requireMember(clan, uid) {
  const member = memberOf(clan, uid);
  if (!member) throw new Error('not_clan_member');
  return member;
}

function requireManagement(clan, uid) {
  const member = requireMember(clan, uid);
  if (!['owner', 'officer'].includes(member.role)) throw new Error('clan_management_required');
  return member;
}

function syncClanId(uid, clanId) {
  const account = getAccountByUid(uid);
  if (!account) throw new Error('player_not_found');
  updateAccount(account.openId, { clanId: Number(clanId || 0) });
}

function publicClan(clan) {
  return {
    id: clan.id,
    name: clan.name,
    tag: clan.tag,
    ownerUid: clan.ownerUid,
    level: clan.level,
    exp: clan.exp,
    memberCount: clan.members.length,
    maxMembers: MAX_MEMBERS,
    members: clan.members.map((member) => ({ ...member })),
    createdAt: clan.createdAt,
    updatedAt: clan.updatedAt
  };
}

export function listClans() {
  return Object.values(loadState().clans)
    .map(publicClan)
    .sort((a, b) => b.memberCount - a.memberCount || a.id - b.id);
}

export function getClan(clanId) {
  const state = loadState();
  const clan = state.clans[String(Number(clanId))];
  return clan ? publicClan(clan) : null;
}

export function getClanForMember(uid) {
  const account = getAccountByUid(uid);
  if (!account || !Number(account.clanId || 0)) return null;
  return getClan(account.clanId);
}

export function createClan(ownerUid, input = {}) {
  const owner = getAccountByUid(ownerUid);
  if (!owner) throw new Error('player_not_found');
  if (Number(owner.clanId || 0) !== 0) throw new Error('already_in_clan');

  const name = cleanName(input.name);
  const tag = cleanTag(input.tag);
  const state = loadState();
  if (Object.values(state.clans).some((clan) => clan.name.toLowerCase() === name.toLowerCase())) throw new Error('clan_name_taken');
  if (Object.values(state.clans).some((clan) => clan.tag === tag)) throw new Error('clan_tag_taken');

  const now = Date.now();
  const id = state.nextClanId++;
  const clan = {
    id,
    name,
    tag,
    ownerUid: Number(ownerUid),
    level: 1,
    exp: 0,
    members: [{ uid: Number(ownerUid), role: 'owner', joinedAt: now }],
    createdAt: now,
    updatedAt: now
  };
  state.clans[String(id)] = clan;
  saveState(state);
  syncClanId(ownerUid, id);
  return publicClan(clan);
}

export function joinClan(uid, clanId) {
  const account = getAccountByUid(uid);
  if (!account) throw new Error('player_not_found');
  if (Number(account.clanId || 0) !== 0) throw new Error('already_in_clan');

  const state = loadState();
  const clan = requireClan(state, clanId);
  if (clan.members.length >= MAX_MEMBERS) throw new Error('clan_full');
  if (memberOf(clan, uid)) return publicClan(clan);

  clan.members.push({ uid: Number(uid), role: 'member', joinedAt: Date.now() });
  clan.updatedAt = Date.now();
  saveState(state);
  syncClanId(uid, clan.id);
  return publicClan(clan);
}

export function leaveClan(uid) {
  const account = getAccountByUid(uid);
  if (!account || !Number(account.clanId || 0)) throw new Error('not_clan_member');

  const state = loadState();
  const clan = requireClan(state, account.clanId);
  const member = requireMember(clan, uid);
  if (member.role === 'owner' && clan.members.length > 1) throw new Error('owner_must_transfer_or_disband');

  clan.members = clan.members.filter((entry) => Number(entry.uid) !== Number(uid));
  clan.updatedAt = Date.now();
  if (clan.members.length === 0) delete state.clans[String(clan.id)];
  saveState(state);
  syncClanId(uid, 0);
  return clan.members.length ? publicClan(clan) : null;
}

export function kickClanMember(actorUid, targetUid) {
  const actor = getAccountByUid(actorUid);
  if (!actor || !Number(actor.clanId || 0)) throw new Error('not_clan_member');
  const state = loadState();
  const clan = requireClan(state, actor.clanId);
  const actorMember = requireManagement(clan, actorUid);
  const target = requireMember(clan, targetUid);
  if (target.role === 'owner') throw new Error('cannot_kick_owner');
  if (actorMember.role === 'officer' && target.role === 'officer') throw new Error('owner_required');

  clan.members = clan.members.filter((entry) => Number(entry.uid) !== Number(targetUid));
  clan.updatedAt = Date.now();
  saveState(state);
  syncClanId(targetUid, 0);
  return publicClan(clan);
}

export function setClanRole(ownerUid, targetUid, role) {
  const actor = getAccountByUid(ownerUid);
  if (!actor || !Number(actor.clanId || 0)) throw new Error('not_clan_member');
  const state = loadState();
  const clan = requireClan(state, actor.clanId);
  const actorMember = requireMember(clan, ownerUid);
  if (actorMember.role !== 'owner') throw new Error('owner_required');
  const target = requireMember(clan, targetUid);

  const nextRole = String(role || '');
  if (!['member', 'officer'].includes(nextRole)) throw new Error('invalid_clan_role');
  if (target.role === 'owner') throw new Error('cannot_change_owner_role');
  target.role = nextRole;
  clan.updatedAt = Date.now();
  saveState(state);
  return publicClan(clan);
}

export function transferClanOwnership(ownerUid, targetUid) {
  const actor = getAccountByUid(ownerUid);
  if (!actor || !Number(actor.clanId || 0)) throw new Error('not_clan_member');
  const state = loadState();
  const clan = requireClan(state, actor.clanId);
  const actorMember = requireMember(clan, ownerUid);
  if (actorMember.role !== 'owner') throw new Error('owner_required');
  const target = requireMember(clan, targetUid);
  if (Number(target.uid) === Number(ownerUid)) return publicClan(clan);

  actorMember.role = 'officer';
  target.role = 'owner';
  clan.ownerUid = Number(targetUid);
  clan.updatedAt = Date.now();
  saveState(state);
  return publicClan(clan);
}

export function disbandClan(ownerUid) {
  const actor = getAccountByUid(ownerUid);
  if (!actor || !Number(actor.clanId || 0)) throw new Error('not_clan_member');
  const state = loadState();
  const clan = requireClan(state, actor.clanId);
  const actorMember = requireMember(clan, ownerUid);
  if (actorMember.role !== 'owner') throw new Error('owner_required');

  const members = clan.members.map((member) => Number(member.uid));
  delete state.clans[String(clan.id)];
  saveState(state);
  for (const uid of members) syncClanId(uid, 0);
  return { id: clan.id, disbanded: true, membersReleased: members.length };
}
