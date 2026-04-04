import { config } from '../config.js';
import { cache } from '../utils/cache.js';

const ORDER_ACCOUNT_SIZE = 201;
const QUOTES = {
  ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx: { symbol: 'ATLAS', decimals: 8 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
};
const MARKETPLACE_SNAPSHOT_TTL_MS = 30_000;

let marketplaceSnapshotPromise = null;

function emptyOrderbook() {
  return {
    floor: null,
    floorQuoteSymbol: null,
    bestOffer: null,
    bestOfferQuoteSymbol: null,
    floorOrderCount: 0,
    bestOfferOrderCount: 0,
    asks: [],
    bids: [],
  };
}

function readUnsignedLittleEndian64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return 0;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const low = view.getUint32(0, true);
  const high = view.getUint32(4, true);
  return low + (high * 4294967296);
}

function base58Encode(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return '';

  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];

  for (const byte of bytes) {
    let carry = byte;

    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = '';

  for (const byte of bytes) {
    if (byte !== 0) break;
    result += '1';
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    result += alphabet[digits[index]];
  }

  return result;
}

function parseOrderAccount(order, requireKnownQuote = true) {
  const payload = order?.account?.data;
  const encoded = Array.isArray(payload) ? payload[0] : null;

  if (typeof encoded !== 'string') return null;

  const raw = Buffer.from(encoded, 'base64');
  if (raw.length < ORDER_ACCOUNT_SIZE) return null;

  const currencyMint = base58Encode(raw.subarray(40, 72));
  const quote = QUOTES[currencyMint] ?? null;
  if (requireKnownQuote && !quote) return null;

  const side = raw[168] === 0 ? 'buy' : 'sell';
  const priceBaseUnits = readUnsignedLittleEndian64(raw.subarray(169, 177));
  const originationQty = readUnsignedLittleEndian64(raw.subarray(177, 185));
  const remainingQty = readUnsignedLittleEndian64(raw.subarray(185, 193));
  const createdAt = readUnsignedLittleEndian64(raw.subarray(193, 201));
  const decimals = quote?.decimals ?? 0;

  return {
    id: typeof order?.pubkey === 'string' ? order.pubkey : null,
    owner: base58Encode(raw.subarray(8, 40)),
    currencyMint,
    assetMint: base58Encode(raw.subarray(72, 104)),
    side,
    rawPrice: priceBaseUnits,
    price: Number((priceBaseUnits / (10 ** decimals)).toFixed(8)),
    originationQty: Number(originationQty.toFixed(8)),
    remainingQty: Number(remainingQty.toFixed(8)),
    quoteSymbol: quote?.symbol ?? 'UNKNOWN',
    createdAt,
    createdAtIso: createdAt > 0 ? new Date(createdAt * 1000).toISOString() : null,
  };
}

function aggregateOrders(orders) {
  const aggregate = emptyOrderbook();

  for (const order of orders) {
    const parsed = parseOrderAccount(order);
    if (!parsed) continue;

    if (parsed.side === 'sell') {
      aggregate.floorOrderCount += 1;
      aggregate.asks.push(parsed);

      if (aggregate.floor === null || parsed.price < aggregate.floor) {
        aggregate.floor = parsed.price;
        aggregate.floorQuoteSymbol = parsed.quoteSymbol;
      }
    } else {
      aggregate.bestOfferOrderCount += 1;
      aggregate.bids.push(parsed);

      if (aggregate.bestOffer === null || parsed.price > aggregate.bestOffer) {
        aggregate.bestOffer = parsed.price;
        aggregate.bestOfferQuoteSymbol = parsed.quoteSymbol;
      }
    }
  }

  aggregate.asks.sort((left, right) => left.price - right.price || right.createdAt - left.createdAt);
  aggregate.bids.sort((left, right) => right.price - left.price || right.createdAt - left.createdAt);
  return aggregate;
}

async function callRpc(method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let response;

  try {
    response = await fetch(config.rpcEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message || 'RPC error');
  }

  return payload?.result ?? null;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProgramAccountsForMint(mint, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callRpc('getProgramAccounts', [
        config.marketplaceProgramId,
        {
          commitment: 'confirmed',
          encoding: 'base64',
          filters: [
            { dataSize: ORDER_ACCOUNT_SIZE },
            { memcmp: { offset: 72, bytes: mint } },
          ],
        },
      ]);

      return Array.isArray(result) ? result : [];
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(150 * attempt);
      }
    }
  }

  throw lastError ?? new Error(`Unable to fetch orderbook for ${mint}`);
}

async function fetchAllProgramAccounts(attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await callRpc('getProgramAccounts', [
        config.marketplaceProgramId,
        {
          commitment: 'confirmed',
          encoding: 'base64',
          filters: [{ dataSize: ORDER_ACCOUNT_SIZE }],
        },
      ]);

      return Array.isArray(result) ? result : [];
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(150 * attempt);
      }
    }
  }

  throw lastError ?? new Error('Unable to fetch marketplace orders');
}

async function refreshOrderbookForMint(mint) {
  const orders = await fetchProgramAccountsForMint(mint);
  return aggregateOrders(orders);
}

export async function getOrderbookForMint(mint) {
  const cacheKey = `orderbook.${mint}`;
  const stale = cache.get(cacheKey);

  try {
    const fresh = await refreshOrderbookForMint(mint);
    return cache.set(cacheKey, fresh, config.orderbookTtlMs);
  } catch {
    return stale ?? emptyOrderbook();
  }
}

export function getCachedOrderbookForMint(mint) {
  return cache.get(`orderbook.${mint}`) ?? null;
}

function buildSellerRows(ships, orderbooks) {
  const rows = [];
  const shipsWithLiveUsdcRows = new Set();

  for (const ship of ships) {
    const mint = ship?.mint;
    if (typeof mint !== 'string' || !mint.trim()) continue;

    const asks = Array.isArray(orderbooks[mint]?.asks) ? orderbooks[mint].asks : [];

    for (const order of asks) {
      if (!order || order.quoteSymbol !== 'USDC') continue;

      shipsWithLiveUsdcRows.add(mint);
      rows.push({
        shipMint: mint,
        shipName: ship.name,
        shipImage: ship.image,
        owner: typeof order.owner === 'string' ? order.owner : null,
        remainingQty: typeof order.remainingQty === 'number' ? order.remainingQty : null,
        price: typeof order.price === 'number' ? order.price : null,
        createdAtIso: typeof order.createdAtIso === 'string' ? order.createdAtIso : null,
      });
    }
  }

  for (const ship of ships) {
    const mint = ship?.mint;
    if (typeof mint !== 'string' || !mint.trim() || shipsWithLiveUsdcRows.has(mint)) continue;

    const price = ship.market?.floor ?? ship.market?.vwap ?? null;
    const quote = String(ship.market?.floorQuoteSymbol || ship.market?.quoteSymbol || 'USDC').toUpperCase();

    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || (quote && quote !== 'USDC')) {
      continue;
    }

    rows.push({
      shipMint: mint,
      shipName: ship.name,
      shipImage: ship.image,
      owner: null,
      remainingQty: ship.market?.listings ?? null,
      price,
      createdAtIso: ship.market?.updatedAt ?? ship.updatedAt ?? null,
    });
  }

  rows.sort((a, b) => a.price - b.price || a.shipName.localeCompare(b.shipName));
  return rows;
}

function buildFallbackSellerRows(ships) {
  const rows = [];

  for (const ship of ships) {
    const mint = ship?.mint;
    if (typeof mint !== 'string' || !mint.trim()) continue;

    const price = ship.market?.floor ?? ship.market?.vwap ?? null;
    const quote = String(ship.market?.floorQuoteSymbol || ship.market?.quoteSymbol || 'USDC').toUpperCase();

    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || (quote && quote !== 'USDC')) {
      continue;
    }

    rows.push({
      shipMint: mint,
      shipName: ship.name,
      shipImage: ship.image,
      owner: null,
      remainingQty: ship.market?.listings ?? null,
      price,
      createdAtIso: ship.market?.updatedAt ?? ship.updatedAt ?? null,
    });
  }

  rows.sort((a, b) => a.price - b.price || a.shipName.localeCompare(b.shipName));
  return rows;
}

function buildLowestSellerRowsByShip(rows) {
  const cheapestByShip = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const mint = row?.shipMint;
    const price = row?.price;

    if (typeof mint !== 'string' || !mint.trim()) continue;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;

    const current = cheapestByShip.get(mint);
    if (!current) {
      cheapestByShip.set(mint, row);
      continue;
    }

    const currentCreatedAt = current.createdAtIso ? Date.parse(current.createdAtIso) : 0;
    const nextCreatedAt = row.createdAtIso ? Date.parse(row.createdAtIso) : 0;

    if (
      price < current.price ||
      (price === current.price && nextCreatedAt > currentCreatedAt) ||
      (price === current.price && nextCreatedAt === currentCreatedAt && String(row.owner || '').localeCompare(String(current.owner || '')) < 0)
    ) {
      cheapestByShip.set(mint, row);
    }
  }

  return Array.from(cheapestByShip.values())
    .sort((a, b) => a.price - b.price || a.shipName.localeCompare(b.shipName));
}

function buildOrderbookIndex(orders) {
  const byMint = new Map();

  for (const order of orders) {
    const parsed = parseOrderAccount(order);
    if (!parsed || !parsed.assetMint) continue;

    const current = byMint.get(parsed.assetMint) ?? emptyOrderbook();

    if (parsed.side === 'sell') {
      current.floorOrderCount += 1;
      current.asks.push(parsed);
      if (current.floor === null || parsed.price < current.floor) {
        current.floor = parsed.price;
        current.floorQuoteSymbol = parsed.quoteSymbol;
      }
    } else {
      current.bestOfferOrderCount += 1;
      current.bids.push(parsed);
      if (current.bestOffer === null || parsed.price > current.bestOffer) {
        current.bestOffer = parsed.price;
        current.bestOfferQuoteSymbol = parsed.quoteSymbol;
      }
    }

    byMint.set(parsed.assetMint, current);
  }

  for (const orderbook of byMint.values()) {
    orderbook.asks.sort((left, right) => left.price - right.price || right.createdAt - left.createdAt);
    orderbook.bids.sort((left, right) => right.price - left.price || right.createdAt - left.createdAt);
  }

  return byMint;
}

async function refreshMarketplaceSnapshot(ships) {
  const orders = await fetchAllProgramAccounts();
  const orderbooks = buildOrderbookIndex(orders);
  const snapshot = {
    orderbooks,
    sellerRows: buildSellerRows(ships, Object.fromEntries(orderbooks)),
  };

  for (const [mint, orderbook] of orderbooks.entries()) {
    cache.set(`orderbook.${mint}`, orderbook, config.orderbookTtlMs);
  }

  return snapshot;
}

async function getMarketplaceSnapshot(ships) {
  const cached = cache.get('marketplace.snapshot');
  if (cached) {
    return cached;
  }

  if (!marketplaceSnapshotPromise) {
    marketplaceSnapshotPromise = refreshMarketplaceSnapshot(ships)
      .then((snapshot) => cache.set('marketplace.snapshot', snapshot, MARKETPLACE_SNAPSHOT_TTL_MS))
      .catch(() => ({
        orderbooks: new Map(),
        sellerRows: buildFallbackSellerRows(ships),
      }))
      .finally(() => {
        marketplaceSnapshotPromise = null;
      });
  }

  return marketplaceSnapshotPromise;
}

export async function getOrderbookForMintFromStore(mint, ships) {
  const snapshot = await getMarketplaceSnapshot(ships);
  return snapshot?.orderbooks?.get(mint) ?? getCachedOrderbookForMint(mint) ?? emptyOrderbook();
}

export async function getAllSellerRows(ships, page = 1, perPage = 25, includeAll = false, mode = 'all') {
  const snapshot = await getMarketplaceSnapshot(ships);
  const sourceRows = Array.isArray(snapshot?.sellerRows) ? snapshot.sellerRows : [];
  const rows = mode === 'lowest-per-ship' ? buildLowestSellerRowsByShip(sourceRows) : sourceRows;
  const safePerPage = Math.max(1, Number(perPage) || 25);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safePerPage));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const offset = (currentPage - 1) * safePerPage;

  return {
    rows: includeAll ? rows : rows.slice(offset, offset + safePerPage),
    pagination: {
      page: currentPage,
      perPage: safePerPage,
      total,
      totalPages,
      hasNextPage: currentPage < totalPages,
      scannedShips: ships.length,
      totalShips: ships.length,
    },
  };
}
