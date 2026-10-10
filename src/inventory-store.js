import fs from 'node:fs';
import path from 'node:path';

const dataFile = process.env.INVENTORY_DATA_FILE || '/data/inventory.json';

const CATALOG = Object.freeze({
  'char.default': { type: 'character', name: 'Default Character' },
  'pet.none': { type: 'pet', name: 'No Pet' },
  'outfit.top.basic': { type: 'top', name: 'Basic Top' },
  'outfit.bottom.basic': { type: 'bottom', name: 'Basic Bottom' },
  'outfit.shoes.basic': { type: 'shoes', name: 'Basic Shoes' },
  'outfit.head.none': { type: 'head', name: 'No Headwear' },
  'outfit.face.none': { type: 'face', name: 'No Face Item' },
  'weapon.skin.default': { type: 'weapon_skin', name: 'Default Weapon Skin' },
  'emote.wave': { type: 'emote', name: 'Wave' },
  'emote.hello': { type: 'emote', name: 'Hello' },
  'profile.banner.default': { type: 'banner', name: 'Default Banner' },
  'profile.avatar.default': { type: 'avatar', name: 'Default Avatar' }
});

const STARTER_ITEMS = Object.freeze([
  'char.default',
  'pet.none',
  'outfit.top.basic',
  'outfit.bottom.basic',
  'outfit.shoes.basic',
  'outfit.head.none',
  'outfit.face.none',
  'weapon.skin.default',
  'emote.wave',
  'emote.hello',
  'profile.banner.default',
  'profile.avatar.default'
]);

function emptyState() {
  return { players: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { players: parsed.players && typeof parsed.players === 'object' ? parsed.players : {} };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[inventory] load failed:', error.message);
    return emptyState();
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

function uidKey(uid) {
  const value = Number(uid);
  if (!Number.isInteger(value) || value <= 0) throw new Error('invalid_uid');
  return String(value);
}

function defaultLoadout() {
  return {
    character: 'char.default',
    pet: 'pet.none',
    top: 'outfit.top.basic',
    bottom: 'outfit.bottom.basic',
    shoes: 'outfit.shoes.basic',
    head: 'outfit.head.none',
    face: 'outfit.face.none',
    weaponSkin: 'weapon.skin.default',
    emotes: ['emote.wave', 'emote.hello'],
    banner: 'profile.banner.default',
    avatar: 'profile.avatar.default'
  };
}

function normalizePlayer(player = {}) {
  return {
    claimedStarter: Boolean(player.claimedStarter),
    items: player.items && typeof player.items === 'object' ? player.items : {},
    loadout: { ...defaultLoadout(), ...(player.loadout || {}) },
    updatedAt: Number(player.updatedAt || 0)
  };
}

export function getCatalog() {
  return CATALOG;
}

export function getInventory(uid) {
  const state = loadState();
  const key = uidKey(uid);
  const player = normalizePlayer(state.players[key]);
  return publicInventory(player);
}

export function claimStarter(uid) {
  const state = loadState();
  const key = uidKey(uid);
  const player = normalizePlayer(state.players[key]);

  if (!player.claimedStarter) {
    const now = Date.now();
    for (const itemId of STARTER_ITEMS) {
      player.items[itemId] ||= { quantity: 1, acquiredAt: now, source: 'starter' };
    }
    player.claimedStarter = true;
    player.updatedAt = now;
    state.players[key] = player;
    saveState(state);
  }

  return publicInventory(player);
}

export function grantItem(uid, itemId, quantity = 1, source = 'server') {
  if (!CATALOG[itemId]) throw new Error('unknown_item');
  const amount = Math.max(1, Math.min(9999, Number(quantity || 1)));
  const state = loadState();
  const key = uidKey(uid);
  const player = normalizePlayer(state.players[key]);
  const current = player.items[itemId] || { quantity: 0, acquiredAt: Date.now(), source };
  current.quantity = Math.min(999999, Number(current.quantity || 0) + amount);
  current.source = source;
  player.items[itemId] = current;
  player.updatedAt = Date.now();
  state.players[key] = player;
  saveState(state);
  return publicInventory(player);
}

function requireOwned(player, itemId, expectedType) {
  if (!CATALOG[itemId]) throw new Error('unknown_item');
  if (CATALOG[itemId].type !== expectedType) throw new Error('wrong_item_type');
  if (!player.items[itemId] || Number(player.items[itemId].quantity || 0) <= 0) throw new Error('item_not_owned');
}

export function updateLoadout(uid, changes = {}) {
  const state = loadState();
  const key = uidKey(uid);
  const player = normalizePlayer(state.players[key]);

  const singleSlots = {
    character: 'character',
    pet: 'pet',
    top: 'top',
    bottom: 'bottom',
    shoes: 'shoes',
    head: 'head',
    face: 'face',
    weaponSkin: 'weapon_skin',
    banner: 'banner',
    avatar: 'avatar'
  };

  for (const [slot, type] of Object.entries(singleSlots)) {
    if (!Object.hasOwn(changes, slot)) continue;
    const itemId = String(changes[slot] || '');
    requireOwned(player, itemId, type);
    player.loadout[slot] = itemId;
  }

  if (Object.hasOwn(changes, 'emotes')) {
    const emotes = Array.isArray(changes.emotes) ? changes.emotes.map(String).slice(0, 8) : [];
    for (const itemId of emotes) requireOwned(player, itemId, 'emote');
    player.loadout.emotes = [...new Set(emotes)];
  }

  player.updatedAt = Date.now();
  state.players[key] = player;
  saveState(state);
  return publicInventory(player);
}

export function publicInventory(player) {
  return {
    claimedStarter: Boolean(player.claimedStarter),
    items: Object.entries(player.items || {}).map(([itemId, entry]) => ({
      itemId,
      type: CATALOG[itemId]?.type || 'unknown',
      name: CATALOG[itemId]?.name || itemId,
      quantity: Number(entry.quantity || 0),
      acquiredAt: Number(entry.acquiredAt || 0),
      source: String(entry.source || '')
    })),
    loadout: player.loadout || defaultLoadout(),
    updatedAt: Number(player.updatedAt || 0)
  };
}
