import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { adjustWalletByUid, accountPublicView } from './account-store.js';
import { getInventory, grantItem } from './inventory-store.js';

const dataFile = process.env.ECONOMY_DATA_FILE || '/data/economy.json';

const OFFERS = Object.freeze({
  'offer.top.red': { itemId: 'outfit.top.red', quantity: 1, currency: 'coins', price: 1500, repeatable: false },
  'offer.bottom.black': { itemId: 'outfit.bottom.black', quantity: 1, currency: 'coins', price: 1800, repeatable: false },
  'offer.head.cap': { itemId: 'outfit.head.cap', quantity: 1, currency: 'coins', price: 1000, repeatable: false },
  'offer.emote.dance': { itemId: 'emote.dance', quantity: 1, currency: 'gems', price: 100, repeatable: false },
  'offer.banner.fire': { itemId: 'profile.banner.fire', quantity: 1, currency: 'coins', price: 2500, repeatable: false },
  'offer.avatar.wolf': { itemId: 'profile.avatar.wolf', quantity: 1, currency: 'gems', price: 150, repeatable: false },
  'offer.weapon.blue': { itemId: 'weapon.skin.blue', quantity: 1, currency: 'gems', price: 300, repeatable: false }
});

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [] };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[economy] load failed:', error.message);
    return { receipts: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dataFile);
}

export function listOffers() {
  return Object.entries(OFFERS).map(([offerId, offer]) => ({ offerId, ...offer }));
}

export function purchase(uid, offerId) {
  const offer = OFFERS[String(offerId || '')];
  if (!offer) throw new Error('offer_not_found');

  const inventoryBefore = getInventory(uid);
  if (!offer.repeatable && inventoryBefore.items.some((item) => item.itemId === offer.itemId && item.quantity > 0)) {
    throw new Error('already_owned');
  }

  const delta = offer.currency === 'gems'
    ? { gems: -offer.price }
    : { coins: -offer.price };

  const account = adjustWalletByUid(uid, delta);
  if (!account) throw new Error('player_not_found');
  const inventory = grantItem(uid, offer.itemId, offer.quantity, 'shop');

  const receipt = {
    id: randomUUID(),
    uid: Number(uid),
    offerId: String(offerId),
    itemId: offer.itemId,
    quantity: offer.quantity,
    currency: offer.currency,
    price: offer.price,
    createdAt: Date.now()
  };

  const state = loadState();
  state.receipts.push(receipt);
  if (state.receipts.length > 50000) state.receipts = state.receipts.slice(-50000);
  saveState(state);

  return {
    receipt,
    wallet: {
      coins: Number(account.coins || 0),
      gems: Number(account.gems || 0)
    },
    account: accountPublicView(account),
    inventory
  };
}

export function purchaseHistory(uid, limit = 50) {
  const max = Math.max(1, Math.min(200, Number(limit || 50)));
  return loadState().receipts
    .filter((receipt) => Number(receipt.uid) === Number(uid))
    .slice(-max)
    .reverse();
}
