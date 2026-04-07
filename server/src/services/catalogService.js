import fs from 'node:fs/promises';
import { config } from '../config.js';
import { cache } from '../utils/cache.js';

function firstNonEmpty(values, fallback = 'Unknown') {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function number(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function lower(value, fallback = 'unknown') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().toLowerCase();
}

function extractAttributes(item) {
  const source = item.attributes ?? item.traits ?? [];
  const result = {};

  if (Array.isArray(source)) {
    for (const attribute of source) {
      if (!attribute || typeof attribute !== 'object') continue;
      const key = attribute.trait_type ?? attribute.traitType ?? attribute.key ?? attribute.name;
      const value = attribute.value ?? attribute.displayValue ?? attribute.val;
      if (typeof key === 'string' && (typeof value === 'string' || typeof value === 'number')) {
        result[key.toLowerCase().replace(/[ -]/g, '_')] = String(value).trim();
      }
    }
    return result;
  }

  if (source && typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string' || typeof value === 'number') {
        result[key.toLowerCase().replace(/[ -]/g, '_')] = String(value).trim();
      }
    }
  }

  return result;
}

function looksLikeShip(item, attributes, category) {
  const categoryHaystack = [
    item.category,
    item.itemType,
    attributes.itemtype,
    attributes.category,
    category,
  ].filter(Boolean).join(' ').toLowerCase();

  const detailsHaystack = [
    item.name,
    item.rarity,
    attributes.class,
    attributes.size,
    attributes.vehicle_type,
    attributes.spec,
  ].filter(Boolean).join(' ').toLowerCase();

  for (const term of ['part', 'bundle', 'skin', 'poster', 'badge', 'resource', 'collectible', 'weapon', 'structure', 'land', 'character', 'crew', 'episode', 'magic eden']) {
    if (categoryHaystack.includes(term) || detailsHaystack.includes(term)) return false;
  }

  if (categoryHaystack.includes('ship') || categoryHaystack.includes('navire')) {
    return true;
  }

  if (Array.isArray(item.slots?.crewSlots) && item.slots.crewSlots.length > 0) {
    return true;
  }

  const knownSizes = new Set(['xx-small', 'xx small', 'xxsmall', 'x-small', 'x small', 'xsmall', 'extra small', 'very small', 'très petit', 'tres petit', 'small', 'petit', 'medium', 'moyen', 'large', 'grand', 'capital', 'commander', 'commandant', 'titan']);
  const knownSpecs = new Set(['bounty-hunter', 'bounty hunter', 'miner', 'fighter', 'freighter', 'multi-role', 'multi role', 'racer', 'repair', 'rescue', 'salvage', 'data-runner', 'data runner', 'bomber']);

  const rawSize = String(attributes.class ?? attributes.size ?? item.class ?? item.size ?? item.itemClass ?? '').trim().toLowerCase();
  const rawSpec = String(attributes.spec ?? item.spec ?? '').trim().toLowerCase();

  return knownSizes.has(rawSize) && knownSpecs.has(rawSpec);
}

function normalizeShipSize(item, attributes) {
  const raw = firstNonEmpty([
    attributes.class,
    attributes.size,
    item.class,
    item.size,
    item.itemClass,
  ], 'unknown').toLowerCase();

  if (['xx-small', 'xx small', 'xxsmall'].includes(raw)) return 'xx-small';
  if (['x-small', 'x small', 'xsmall', 'extra small', 'very small', 'très petit', 'tres petit'].includes(raw)) return 'very-small';
  if (['small', 'petit'].includes(raw)) return 'small';
  if (['medium', 'moyen'].includes(raw)) return 'medium';
  if (['large', 'grand'].includes(raw)) return 'large';
  if (['capital'].includes(raw)) return 'capital';
  if (['commander', 'commandant'].includes(raw)) return 'commander';
  if (['titan'].includes(raw)) return 'titan';

  return 'unknown';
}

function countCrewSlots(item, attributes) {
  const fromAttributes = number(attributes.crew ?? item.crew);
  if (typeof fromAttributes === 'number' && fromAttributes > 0) {
    return Math.round(fromAttributes);
  }

  const crewSlots = Array.isArray(item.slots?.crewSlots) ? item.slots.crewSlots : [];
  if (crewSlots.length === 0) {
    return null;
  }

  const total = crewSlots.reduce((sum, slot) => {
    const quantity = typeof slot?.quantity === 'number' && Number.isFinite(slot.quantity) ? slot.quantity : 1;
    return sum + quantity;
  }, 0);

  return total > 0 ? total : null;
}

function findFirstNumeric(payloads, keys) {
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value);
    }
  }
  return null;
}

function findQuoteSymbol(markets, tradeSettings) {
  const values = [
    ...(Array.isArray(markets) ? markets : []),
    tradeSettings && typeof tradeSettings === 'object' ? tradeSettings : {},
  ];

  for (const payload of values) {
    if (!payload || typeof payload !== 'object') continue;
    for (const key of ['quotePair', 'quoteSymbol', 'currencySymbol']) {
      const candidate = payload[key];
      if (typeof candidate !== 'string') continue;
      const upper = candidate.toUpperCase();
      if (upper.includes('USDC')) return 'USDC';
      if (upper.includes('ATLAS')) return 'ATLAS';
    }
  }

  return null;
}

function extractCatalogMarket(item) {
  const markets = Array.isArray(item.markets) ? item.markets.filter((entry) => entry && typeof entry === 'object') : [];
  const tradeSettings = item.tradeSettings && typeof item.tradeSettings === 'object' ? item.tradeSettings : {};
  const floor = findFirstNumeric([...markets, tradeSettings], ['floor', 'floorPrice', 'minPrice', 'lowestPrice', 'askPrice', 'sellPrice', 'vwap']);
  const bestOffer = findFirstNumeric([...markets, tradeSettings], ['bestOffer', 'bestBid', 'bidPrice', 'offerPrice', 'highestOffer', 'highestBid']);
  const quoteSymbol = findQuoteSymbol(markets, tradeSettings) ?? 'USDC';

  return {
    floor,
    bestOffer,
    vwap: number(tradeSettings.vwap),
    msrp: number(tradeSettings.msrp?.value),
    msrpSymbol: typeof tradeSettings.msrp?.currencySymbol === 'string' ? tradeSettings.msrp.currencySymbol : 'USDC',
    listings: markets.length > 0 ? markets.length : null,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
    floorQuoteSymbol: quoteSymbol,
    bestOfferQuoteSymbol: quoteSymbol,
  };
}

function normalizeCatalogItem(item) {
  if (!item || typeof item !== 'object') return null;

  const attributes = extractAttributes(item);
  const category = lower(firstNonEmpty([
    attributes.category,
    item.category,
    item.itemType,
    attributes.itemtype,
    attributes.type,
    attributes.class,
  ], 'unknown'));
  const itemType = lower(firstNonEmpty([
    item.itemType,
    attributes.itemtype,
    attributes.type,
    item.category,
  ], category));
  const isShip = looksLikeShip(item, attributes, category);
  const name = firstNonEmpty([item.name, item.title, attributes.name], 'Unknown item');
  const mint = firstNonEmpty([item.mint, item.mintAddress, item.id], `mint-${name}`);
  const collection = item.collection && typeof item.collection === 'object' ? item.collection : null;

  return {
    mint,
    symbol: firstNonEmpty([item.symbol], ''),
    name,
    description: firstNonEmpty([item.description], ''),
    image: firstNonEmpty([
      item.image,
      item.imageUrl,
      item.media?.image,
      item.media?.thumbnailUrl,
      attributes.image_url,
      '',
    ], ''),
    thumbnail: firstNonEmpty([
      item.media?.thumbnailUrl,
      item.image,
      item.imageUrl,
      '',
    ], ''),
    faction: firstNonEmpty([item.faction, attributes.faction], 'Unknown faction'),
    rarity: lower(firstNonEmpty([item.rarity, attributes.rarity], 'common'), 'common'),
    category,
    itemType,
    manufacturer: firstNonEmpty([item.manufacturer, attributes.manufacturer, attributes.make, attributes.brand], 'Unknown'),
    spec: lower(firstNonEmpty([attributes.spec, attributes.specification, item.spec], 'unknown')),
    size: normalizeShipSize(item, attributes),
    className: lower(firstNonEmpty([attributes.class, item.class, item.itemClass], 'unknown')),
    tier: firstNonEmpty([attributes.tier, item.tier], 'Unknown'),
    crew: countCrewSlots(item, attributes),
    cargo: number(attributes.cargo ?? attributes.cargo_capacity ?? item.cargo),
    fuel: number(attributes.fuel ?? item.fuel),
    updatedAt: item.updatedAt ?? null,
    totalSupply: number(item.totalSupply),
    collectionName: firstNonEmpty([collection?.name], ''),
    collectionFamily: firstNonEmpty([collection?.family], ''),
    market: extractCatalogMarket(item),
    featuredInShowroom: false,
    isShip,
  };
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status} on ${url}`);
  return response.json();
}

async function loadFallbackSample() {
  try {
    const content = await fs.readFile(config.sampleDatasetPath, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadRawCatalog() {
  const catalogUrl = `${config.galaxyApiBase}${config.catalogEndpoint}`;
  const showroomUrl = `${config.galaxyApiBase}${config.showroomEndpoint}`;

  let rawItems = [];
  let showroomMints = [];

  try {
    const payload = await fetchJson(catalogUrl);
    rawItems = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  } catch {
    rawItems = await loadFallbackSample();
  }

  try {
    const payload = await fetchJson(showroomUrl);
    showroomMints = Array.isArray(payload) ? payload.filter((value) => typeof value === 'string' && value.trim()) : [];
  } catch {
    showroomMints = [];
  }

  return { rawItems, showroomMints };
}

export async function getItemsCatalog() {
  return cache.getOrSet('catalog.items', config.cacheTtlMs, async () => {
    const { rawItems, showroomMints } = await loadRawCatalog();
    const showroomSet = new Set(showroomMints);

    const items = rawItems
      .map(normalizeCatalogItem)
      .filter(Boolean)
      .map((item) => ({
        ...item,
        featuredInShowroom: showroomSet.has(item.mint),
      }));

    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  });
}

export async function getShipsCatalog() {
  const items = await getItemsCatalog();
  return items.filter((item) => item.isShip);
}
