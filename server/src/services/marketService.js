import { getShipsCatalog } from './catalogService.js';
import { getAllSellerRows, getOrderbookForMintFromStore } from './orderbookService.js';

const rarityWeights = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
const sizeOrder = ['xx-small', 'very-small', 'small', 'medium', 'large', 'capital', 'commander', 'titan', 'unknown'];
const sizeLabels = {
  'xx-small': 'XX-Small',
  'very-small': 'Très petit',
  'small': 'Petit',
  'medium': 'Moyen',
  'large': 'Grand',
  'capital': 'Capital',
  'commander': 'Commandant',
  'titan': 'Titan',
  'unknown': 'Autres',
};

function groupShips(ships, sort = 'name') {
  const groups = new Map();

  for (const sizeKey of sizeOrder) {
    groups.set(sizeKey, []);
  }

  for (const ship of ships) {
    const key = sizeOrder.includes(ship.size) ? ship.size : 'unknown';
    groups.get(key).push(ship);
  }

  const sortFn = (a, b) => {
    if (sort === 'rarity') {
      const left = rarityWeights[a.rarity] ?? 99;
      const right = rarityWeights[b.rarity] ?? 99;
      if (left !== right) return left - right;
    }
    return a.name.localeCompare(b.name);
  };

  return sizeOrder
    .map((key) => ({ key, label: sizeLabels[key], items: groups.get(key).sort(sortFn) }))
    .filter((group) => group.items.length > 0);
}

function preferUsdcRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const usdc = list.filter((row) => row?.quoteSymbol === 'USDC');
  return (usdc.length > 0 ? usdc : list).slice(0, 12);
}

export async function getShipsSummary(sort = 'name') {
  const ships = await getShipsCatalog();
  return {
    ships,
    groupedShips: groupShips(ships, sort),
  };
}

export async function getShipDetail(mint, sort = 'name') {
  const ships = await getShipsCatalog();
  const ship = ships.find((entry) => entry.mint === mint) ?? ships[0] ?? null;
  if (!ship) return null;

  const orderbook = await getOrderbookForMintFromStore(ship.mint, ships);
  const asks = preferUsdcRows(orderbook.asks);
  const bids = preferUsdcRows(orderbook.bids);

  return {
    ship: {
      ...ship,
      market: {
        ...ship.market,
        asks,
        bids,
        floor: orderbook.floor ?? ship.market?.floor ?? ship.market?.vwap ?? null,
        floorQuoteSymbol: orderbook.floorQuoteSymbol ?? ship.market?.floorQuoteSymbol ?? 'USDC',
        bestOffer: orderbook.bestOffer ?? ship.market?.bestOffer ?? null,
        bestOfferQuoteSymbol: orderbook.bestOfferQuoteSymbol ?? ship.market?.bestOfferQuoteSymbol ?? 'USDC',
        lastSale: ship.market?.vwap ?? null,
        vwap: ship.market?.vwap ?? null,
      },
    },
    ships,
    groupedShips: groupShips(ships, sort),
    selectedSort: sort,
  };
}

export async function getSellersPage(page = 1, perPage = 25, mode = 'all') {
  const ships = await getShipsCatalog();
  return getAllSellerRows(ships, page, perPage, false, mode);
}
