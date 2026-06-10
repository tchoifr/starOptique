<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import logoImage from '../assets/logo.png';
import headerImage from '../assets/starvisionHeader.png';
import { api } from '../services/api.js';
import { connectPhantom, disconnectPhantom, getPhantomProvider } from '../services/phantom.js';
import {
  buyNftWithPhantom,
  cancelNftListingWithPhantom,
} from '../services/customMarketplace.js';

const route = useRoute();

const PAGE_SIZE = 6;

const marketConfig = ref(null);
const ships = ref([]);
const selectedMint = ref('');
const selectedShip = ref(null);
const sellerRows = ref([]);
const listings = ref([]);
const wallet = ref('');
const walletItems = ref([]);
const error = ref('');
const success = ref('');
const loading = ref(true);
const shipLoading = ref(false);
const walletLoading = ref(false);
const actionLoading = ref(false);
const search = ref('');
const classFilter = ref('');
const rarityFilter = ref('');
const makerFilter = ref('');
const sortMode = ref('price');
const sellersLowestOnly = ref(false);
const activeBookTab = ref('orderbook');
const page = ref(1);
let phantomAccountChangedHandler = null;
let phantomDisconnectHandler = null;

const rarityLabels = {
  anomaly: 'Anomaly',
  legendary: 'Legendary',
  epic: 'Epic',
  rare: 'Rare',
  uncommon: 'Uncommon',
  common: 'Common',
};

const sizeLabels = {
  'xx-small': 'XX-Small',
  'very-small': 'Very Small',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  capital: 'Capital',
  commander: 'Commander',
  titan: 'Titan',
  unknown: 'Unknown',
};

function shortAddress(value) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : 'n/a';
}

function formatRarity(value) {
  return rarityLabels[value] || value || 'Common';
}

function formatSize(value) {
  return sizeLabels[value] || value || 'Unknown';
}

function formatPrice(value, symbol = 'USDC') {
  const formatted = formatAmount(value);
  return formatted === '-' ? `- ${symbol}` : `${formatted} ${symbol}`;
}

function formatAmount(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatOrderPrice(order) {
  return formatAmount(order?.price);
}

function formatDate(value) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function marketPrice(ship) {
  return ship?.market?.floor ?? ship?.market?.vwap ?? ship?.market?.msrp ?? null;
}

function marketSymbol(ship) {
  return ship?.market?.floorQuoteSymbol || ship?.market?.msrpSymbol || 'USDC';
}

function resetMessages() {
  error.value = '';
  success.value = '';
}

const walletUnits = computed(() => walletItems.value.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0));
const myListings = computed(() => listings.value.filter((row) => row.seller === wallet.value));
const publicListings = computed(() => listings.value.filter((row) => row.seller !== wallet.value));

const classOptions = computed(() => [...new Set(ships.value.map((ship) => ship.size).filter(Boolean))]);
const rarityOptions = computed(() => [...new Set(ships.value.map((ship) => ship.rarity).filter(Boolean))]);
const makerOptions = computed(() => [...new Set(ships.value.map((ship) => ship.manufacturer).filter(Boolean))].slice(0, 16));

const listingByMint = computed(() => {
  const map = new Map();
  for (const row of listings.value) {
    if (row.shipMint && !map.has(row.shipMint)) {
      map.set(row.shipMint, row);
    }
  }
  return map;
});

const filteredShips = computed(() => {
  const text = search.value.trim().toLowerCase();
  const rows = ships.value.filter((ship) => {
    const haystack = [ship.name, ship.manufacturer, ship.spec, ship.rarity].filter(Boolean).join(' ').toLowerCase();
    if (text && !haystack.includes(text)) return false;
    if (classFilter.value && ship.size !== classFilter.value) return false;
    if (rarityFilter.value && ship.rarity !== rarityFilter.value) return false;
    if (makerFilter.value && ship.manufacturer !== makerFilter.value) return false;
    return true;
  });

  return [...rows].sort((left, right) => {
    if (sortMode.value === 'rarity') {
      const rarityWeight = { anomaly: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5 };
      const diff = (rarityWeight[left.rarity] ?? 99) - (rarityWeight[right.rarity] ?? 99);
      if (diff !== 0) return diff;
    }

    if (sortMode.value === 'price') {
      const leftPrice = marketPrice(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = marketPrice(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    }

    return left.name.localeCompare(right.name);
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredShips.value.length / PAGE_SIZE)));
const currentPage = computed(() => Math.min(page.value, totalPages.value));
const visibleShips = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredShips.value.slice(start, start + PAGE_SIZE);
});

const sellerTableRows = computed(() => {
  const shipByMint = new Map(ships.value.map((ship) => [ship.mint, ship]));

  const customRows = publicListings.value.map((row) => ({
    key: `custom-${row.listing}`,
    source: 'custom',
    raw: row,
    shipMint: row.shipMint,
    shipName: row.shipName,
    shipImage: row.shipImage,
    rarity: row.rarity || shipByMint.get(row.shipMint)?.rarity || 'common',
    seller: row.seller,
    price: row.price,
    quoteSymbol: row.quoteSymbol || 'USDC',
    quantity: row.quantity || 1,
    buyable: true,
  }));

  const externalRows = sellerRows.value.map((row) => ({
    key: `external-${row.shipMint}-${row.owner}-${row.price}-${row.createdAtIso}`,
    source: 'external',
    raw: row,
    shipMint: row.shipMint,
    shipName: row.shipName,
    shipImage: row.shipImage,
    rarity: shipByMint.get(row.shipMint)?.rarity || 'common',
    seller: row.owner,
    price: Number(row.price),
    quoteSymbol: 'USDC',
    quantity: row.remainingQty || 1,
    buyable: false,
  }));

  return [...customRows, ...externalRows]
    .sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 12);
});

const selectedListing = computed(() => (selectedShip.value ? listingByMint.value.get(selectedShip.value.mint) : null));
const selectedAsks = computed(() => selectedShip.value?.market?.asks || []);
const selectedBids = computed(() => selectedShip.value?.market?.bids || []);

watch([search, classFilter, rarityFilter, makerFilter, sortMode], () => {
  page.value = 1;
});

watch(sellersLowestOnly, () => {
  loadSellerRows();
});

async function loadSellerRows() {
  const data = await api.getSellers(1, 24, sellersLowestOnly.value ? 'lowest-per-ship' : 'all');
  sellerRows.value = data.rows || [];
}

async function loadShipDetail(mint) {
  if (!mint) return;
  selectedMint.value = mint;
  shipLoading.value = true;
  try {
    const data = await api.getShip(mint, sortMode.value === 'rarity' ? 'rarity' : 'name');
    selectedShip.value = data.ship;
  } catch (err) {
    error.value = err.message || 'Impossible de charger le vaisseau.';
  } finally {
    shipLoading.value = false;
  }
}

async function loadListings() {
  const data = await api.getMarketplaceListings();
  listings.value = data.rows || [];
  marketConfig.value = data.config || marketConfig.value;
}

async function loadWalletInventories() {
  if (!wallet.value) {
    walletItems.value = [];
    return;
  }

  walletLoading.value = true;
  try {
    const mainnetData = await api.getWalletNfts(wallet.value);
    walletItems.value = mainnetData.items || [];
    if (mainnetData.partial) {
      error.value = 'Inventaire charge partiellement.';
    }
  } catch (err) {
    error.value = err.message || 'Impossible de rafraichir l inventaire du wallet.';
  } finally {
    walletLoading.value = false;
  }
}

async function syncWalletFromProvider({ reloadInventories = false } = {}) {
  const provider = getPhantomProvider();
  const nextWallet = provider?.publicKey?.toBase58?.() || '';
  const previousWallet = wallet.value;

  if (nextWallet === previousWallet) {
    if (reloadInventories && nextWallet) {
      await loadWalletInventories();
    }
    return nextWallet;
  }

  wallet.value = nextWallet;

  if (!nextWallet) {
    walletItems.value = [];
    return '';
  }

  await loadWalletInventories();
  return nextWallet;
}

async function refreshAll() {
  loading.value = true;
  resetMessages();
  try {
    const [configData, catalogData] = await Promise.all([
      api.getMarketplaceConfig(),
      api.getShips(sortMode.value === 'rarity' ? 'rarity' : 'name'),
    ]);

    marketConfig.value = configData;
    ships.value = catalogData.ships || [];

    await Promise.all([
      loadListings(),
      loadSellerRows(),
      syncWalletFromProvider(),
    ]);

    const queryMint = typeof route.query.ship === 'string' ? route.query.ship : '';
    const nextMint = ships.value.find((ship) => ship.mint === queryMint)?.mint
      || ships.value.find((ship) => ship.mint === selectedMint.value)?.mint
      || filteredShips.value[0]?.mint
      || ships.value[0]?.mint
      || '';

    if (nextMint) {
      const summaryShip = ships.value.find((ship) => ship.mint === nextMint);
      selectedShip.value = summaryShip || null;
      await loadShipDetail(nextMint);
    }
  } catch (err) {
    error.value = err.message || 'Erreur de chargement du marketplace.';
  } finally {
    loading.value = false;
  }
}

async function connectWallet({ silent = false } = {}) {
  resetMessages();
  try {
    const { publicKey } = await connectPhantom({ onlyIfTrusted: silent });
    if (!publicKey) return;
    wallet.value = publicKey.toBase58();
    await loadWalletInventories();
  } catch (err) {
    if (!silent) {
      error.value = err.message || 'Connexion Phantom impossible.';
    }
  }
}

async function disconnectWalletAction() {
  await disconnectPhantom();
  wallet.value = '';
  walletItems.value = [];
  resetMessages();
}

async function cancelListing(row) {
  resetMessages();
  actionLoading.value = true;
  try {
    await syncWalletFromProvider();
    const signature = await cancelNftListingWithPhantom({
      nftMint: row.shipMint,
      listing: row.listing,
      vault: row.vault,
      quantity: row.quantity,
    });
    success.value = `Listing annule: ${signature}`;
    await refreshAll();
  } catch (err) {
    error.value = err.message || 'Impossible d annuler le listing.';
  } finally {
    actionLoading.value = false;
  }
}

async function buyListing(row) {
  resetMessages();
  actionLoading.value = true;
  try {
    await syncWalletFromProvider();
    const signature = await buyNftWithPhantom({
      nftMint: row.shipMint,
      seller: row.seller,
      listing: row.listing,
      vault: row.vault,
      priceBaseUnits: row.priceBaseUnits,
      quantity: row.quantity,
    });
    success.value = `Achat confirme: ${signature}`;
    await refreshAll();
  } catch (err) {
    error.value = err.message || 'Impossible d acheter ce NFT.';
  } finally {
    actionLoading.value = false;
  }
}

async function buySellerRow(row) {
  if (!row.buyable) return;
  await buyListing(row.raw);
}

async function selectShip(ship) {
  selectedShip.value = ship;
  selectedMint.value = ship.mint;
  await loadShipDetail(ship.mint);
}

async function selectSellerRow(row) {
  const ship = ships.value.find((entry) => entry.mint === row.shipMint);
  if (ship) {
    await selectShip(ship);
  }
  scrollToSection('details');
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goToPage(nextPage) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value);
}

onMounted(async () => {
  const provider = getPhantomProvider();

  if (provider?.on) {
    phantomAccountChangedHandler = async (publicKey) => {
      wallet.value = publicKey?.toBase58?.() || '';
      if (!wallet.value) {
        walletItems.value = [];
        return;
      }
      await refreshAll();
    };

    phantomDisconnectHandler = () => {
      wallet.value = '';
      walletItems.value = [];
      resetMessages();
    };

    provider.on('accountChanged', phantomAccountChangedHandler);
    provider.on('disconnect', phantomDisconnectHandler);
  }

  await refreshAll();
  await connectWallet({ silent: true });
});

onBeforeUnmount(() => {
  const provider = getPhantomProvider();
  if (provider?.off && phantomAccountChangedHandler) {
    provider.off('accountChanged', phantomAccountChangedHandler);
  }
  if (provider?.off && phantomDisconnectHandler) {
    provider.off('disconnect', phantomDisconnectHandler);
  }
});
</script>

<template>
  <main class="sv-page">
    <section id="top" class="sv-landing-hero" aria-label="StarVision">
      <img :src="headerImage" alt="StarVision" class="sv-landing-image" />
      <div class="sv-landing-shade"></div>
      <div class="sv-landing-content">
        <a class="sv-landing-brand" href="#marketplace">
          <img :src="logoImage" alt="" />
          <span>StarVision</span>
        </a>
        <h1>StarVision</h1>
        <p>Catalogue, orderbook, vendeurs et gestion wallet sur une seule page.</p>
        <div class="sv-landing-actions">
          <a href="#marketplace">Ouvrir le marketplace</a>
          <a href="#catalogue">Voir le catalogue</a>
          <a href="#vendeurs">Voir les vendeurs</a>
        </div>
      </div>
    </section>

    <section id="marketplace" class="starvision-dashboard" aria-label="Marketplace StarVision">
    <aside class="sv-sidebar">
      <a class="sv-brand" href="#top">
        <img :src="logoImage" alt="" />
        <span>StarVision</span>
      </a>

      <nav class="sv-nav" aria-label="Navigation StarVision">
        <button type="button" class="sv-nav-item active" @click="scrollToSection('marketplace')"><span>▣</span>Marketplace</button>
        <button type="button" class="sv-nav-item" @click="scrollToSection('catalogue')"><span>▤</span>Catalogue</button>
        <button type="button" class="sv-nav-item" @click="scrollToSection('vendeurs')"><span>≡</span>Vendeurs</button>
        <button type="button" class="sv-nav-item" @click="scrollToSection('wallet-options')"><span>◈</span>Mes NFTs</button>
        <button type="button" class="sv-nav-item" @click="scrollToSection('custom-listings')"><span>□</span>Mes Listings</button>
        <button type="button" class="sv-nav-item" @click="scrollToSection('transactions')"><span>○</span>Transactions</button>
      </nav>

      <div class="sv-sidebar-card">
        <span class="sv-sidebar-label">Wallet connecte</span>
        <button v-if="!wallet" type="button" class="sv-wallet-button" @click="connectWallet()">Connecter Phantom</button>
        <button v-else type="button" class="sv-wallet-button connected" @click="disconnectWalletAction">
          Phantom <small>{{ shortAddress(wallet) }}</small>
        </button>
      </div>

      <div class="sv-sidebar-card compact">
        <span class="sv-sidebar-label">Reseau</span>
        <strong>Devnet</strong>
      </div>

      <div class="sv-balance-card">
        <div><span>SOL</span><strong>0.00</strong></div>
        <div><span>NFT</span><strong>{{ walletUnits }}</strong></div>
      </div>
    </aside>

    <section class="sv-workspace">
      <section id="catalogue" class="sv-panel sv-catalog-panel">
        <header class="sv-panel-head">
          <div>
            <h1>Catalogue des vaisseaux</h1>
            <p>{{ filteredShips.length }} navires disponibles</p>
          </div>
          <input v-model="search" class="sv-search" type="search" placeholder="Rechercher un vaisseau..." />
        </header>

        <div class="sv-toolbar">
          <label>
            <span>Classe</span>
            <select v-model="classFilter">
              <option value="">Toutes</option>
              <option v-for="value in classOptions" :key="value" :value="value">{{ formatSize(value) }}</option>
            </select>
          </label>
          <label>
            <span>Rarete</span>
            <select v-model="rarityFilter">
              <option value="">Toutes</option>
              <option v-for="value in rarityOptions" :key="value" :value="value">{{ formatRarity(value) }}</option>
            </select>
          </label>
          <label>
            <span>Constructeur</span>
            <select v-model="makerFilter">
              <option value="">Tous</option>
              <option v-for="value in makerOptions" :key="value" :value="value">{{ value }}</option>
            </select>
          </label>
          <label>
            <span>Trier par</span>
            <select v-model="sortMode">
              <option value="price">Prix croissant</option>
              <option value="rarity">Rarete</option>
              <option value="name">Nom</option>
            </select>
          </label>
        </div>

        <div v-if="loading" class="sv-state">Chargement du catalogue...</div>
        <div v-else-if="error" class="sv-state error">{{ error }}</div>
        <div v-else class="sv-ship-grid">
          <button
            v-for="ship in visibleShips"
            :key="ship.mint"
            type="button"
            class="sv-ship-card"
            :class="{ selected: ship.mint === selectedMint }"
            @click="selectShip(ship)"
          >
            <span class="sv-rarity-chip" :data-rarity="ship.rarity">{{ formatRarity(ship.rarity) }}</span>
            <img :src="ship.image" :alt="ship.name" loading="lazy" />
            <strong>{{ ship.name }}</strong>
            <span class="rarity" :data-rarity="ship.rarity">{{ formatRarity(ship.rarity) }}</span>
            <small>{{ ship.manufacturer || 'Star Atlas' }}</small>
            <b>{{ formatPrice(marketPrice(ship), marketSymbol(ship)) }}</b>
          </button>
        </div>

        <footer class="sv-pagination">
          <span>Page {{ currentPage }} sur {{ totalPages }}</span>
          <button type="button" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">‹</button>
          <button type="button" class="active">1</button>
          <button type="button" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
        </footer>
      </section>

      <section id="details" class="sv-panel sv-detail-panel">
        <div v-if="!selectedShip" class="sv-state">Selectionne un vaisseau.</div>
        <template v-else>
          <header class="sv-detail-head">
            <div>
              <h2>{{ selectedShip.name }}</h2>
              <span>#{{ shortAddress(selectedShip.mint) }}</span>
              <span class="sv-rarity-chip inline" :data-rarity="selectedShip.rarity">{{ formatRarity(selectedShip.rarity) }}</span>
            </div>
            <button type="button" class="sv-icon-button" aria-label="Fermer">×</button>
          </header>

          <div class="sv-detail-visual">
            <img :src="selectedShip.image" :alt="selectedShip.name" />
          </div>

          <div class="sv-stats-grid">
            <div><span>Classe</span><strong>{{ formatSize(selectedShip.size) }}</strong></div>
            <div><span>Constructeur</span><strong>{{ selectedShip.manufacturer || 'Unknown' }}</strong></div>
            <div><span>Equipage</span><strong>{{ selectedShip.crew ?? '-' }}</strong></div>
            <div><span>Rarete</span><strong>{{ formatRarity(selectedShip.rarity) }}</strong></div>
          </div>

          <div class="sv-market-strip">
            <div>
              <span>Prix du marche</span>
              <strong>{{ formatPrice(marketPrice(selectedShip), marketSymbol(selectedShip)) }}</strong>
            </div>
            <div>
              <span>Proprietaire</span>
              <strong>{{ wallet ? shortAddress(wallet) : 'Non connecte' }}</strong>
            </div>
          </div>

          <div class="sv-tabs">
            <button type="button" :class="{ active: activeBookTab === 'details' }" @click="activeBookTab = 'details'">Details</button>
            <button type="button" :class="{ active: activeBookTab === 'orderbook' }" @click="activeBookTab = 'orderbook'">Orderbook</button>
            <button type="button" :class="{ active: activeBookTab === 'history' }" @click="activeBookTab = 'history'">Historique</button>
          </div>

          <div v-if="shipLoading" class="sv-state small">Mise a jour...</div>
          <div v-else-if="activeBookTab === 'details'" class="sv-detail-copy">
            {{ selectedShip.description || 'Aucune description disponible pour ce vaisseau.' }}
          </div>
          <div v-else-if="activeBookTab === 'history'" class="sv-history">
            <div><span>Derniere vente</span><strong>{{ formatPrice(selectedShip.market?.lastSale, 'USDC') }}</strong></div>
            <div><span>VWAP</span><strong>{{ formatPrice(selectedShip.market?.vwap, 'USDC') }}</strong></div>
            <div><span>Mis a jour</span><strong>{{ formatDate(selectedShip.updatedAt || selectedShip.market?.updatedAt) }}</strong></div>
          </div>
          <div v-else class="sv-book-grid">
            <div class="sv-book-side">
              <h3>Ordres vendeurs</h3>
              <div class="sv-book-head"><span>Prix</span><span>Quantite</span><span>Total</span></div>
              <div v-for="order in selectedAsks.slice(0, 5)" :key="order.id" class="sv-book-row sell">
                <span>{{ formatOrderPrice(order) }}</span>
                <span>{{ order.remainingQty || 1 }}</span>
                <span>{{ formatAmount((order.price || 0) * (order.remainingQty || 1)) }}</span>
              </div>
              <p v-if="selectedAsks.length === 0" class="sv-empty-row">Aucun vendeur.</p>
            </div>

            <div class="sv-book-side">
              <h3>Ordres acheteurs</h3>
              <div class="sv-book-head"><span>Prix</span><span>Quantite</span><span>Total</span></div>
              <div v-for="order in selectedBids.slice(0, 5)" :key="order.id" class="sv-book-row buy">
                <span>{{ formatOrderPrice(order) }}</span>
                <span>{{ order.remainingQty || 1 }}</span>
                <span>{{ formatAmount((order.price || 0) * (order.remainingQty || 1)) }}</span>
              </div>
              <p v-if="selectedBids.length === 0" class="sv-empty-row">Aucun acheteur.</p>
            </div>
          </div>

          <button
            v-if="selectedListing && selectedListing.seller === wallet"
            type="button"
            class="sv-primary-button"
            :disabled="actionLoading"
            @click="cancelListing(selectedListing)"
          >
            Annuler mon listing
          </button>
          <button v-else type="button" class="sv-primary-button" @click="scrollToSection('wallet-options')">
            Voir mes NFTs et listings
          </button>
        </template>
      </section>

      <section id="vendeurs" class="sv-panel sv-sellers-panel">
        <header class="sv-panel-head sellers">
          <div>
            <h2>Tous les vendeurs</h2>
            <p>Trie par prix croissant</p>
          </div>
          <label class="sv-check">
            <input v-model="sellersLowestOnly" type="checkbox" />
            <span>Moins cher par navire</span>
          </label>
        </header>

        <p v-if="marketConfig" class="sv-program-line">
          Programme custom: {{ shortAddress(marketConfig.programId) }} · Fee {{ marketConfig.platformFeeBps / 100 }}%
        </p>
        <p v-if="success" class="sv-message success">{{ success }}</p>
        <p v-if="error" class="sv-message error">{{ error }}</p>

        <div class="sv-seller-table">
          <div class="sv-seller-head">
            <span>Vaisseau</span>
            <span>Rarete</span>
            <span>Vendeur</span>
            <span>Prix</span>
            <span>Quantite</span>
            <span></span>
          </div>

          <div v-if="loading" class="sv-state">Chargement des vendeurs...</div>
          <div v-else-if="sellerTableRows.length === 0" class="sv-state">Aucun vendeur disponible.</div>
          <template v-else>
            <div v-for="row in sellerTableRows" :key="row.key" class="sv-seller-row">
              <button type="button" class="sv-seller-ship" @click="selectSellerRow(row)">
                <img :src="row.shipImage" :alt="row.shipName" loading="lazy" />
                <strong>{{ row.shipName }}</strong>
              </button>
              <span class="rarity" :data-rarity="row.rarity">{{ formatRarity(row.rarity) }}</span>
              <span>{{ shortAddress(row.seller) }}</span>
              <strong>{{ formatAmount(row.price) }}</strong>
              <span>{{ row.quantity }}</span>
              <button
                type="button"
                class="sv-buy-button"
                :disabled="actionLoading || !wallet || !row.buyable"
                :title="row.buyable ? 'Acheter ce listing custom' : 'Ordre externe en lecture seule'"
                @click="buySellerRow(row)"
              >
                Acheter
              </button>
            </div>
          </template>
        </div>
      </section>

      <section id="wallet-options" class="sv-options-grid">
        <article class="sv-panel sv-option-panel">
          <header class="sv-option-head">
            <div>
              <h2>Mes NFTs reels</h2>
              <p>{{ wallet ? `${walletItems.length} mints · ${walletUnits} unites` : 'Wallet non connecte' }}</p>
            </div>
            <button v-if="!wallet" type="button" class="sv-mini-action" @click="connectWallet()">Connecter</button>
            <button v-else type="button" class="sv-mini-action" @click="loadWalletInventories">Rafraichir</button>
          </header>

          <div v-if="!wallet" class="sv-option-empty">Connecte Phantom pour afficher ton inventaire.</div>
          <div v-else-if="walletLoading" class="sv-option-empty">Chargement des NFTs mainnet...</div>
          <div v-else-if="walletItems.length === 0" class="sv-option-empty">Aucun NFT trouve sur ce wallet.</div>
          <div v-else class="sv-option-list">
            <div v-for="item in walletItems.slice(0, 6)" :key="item.mint" class="sv-option-row">
              <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy" />
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.manufacturer || item.category || 'Star Atlas' }} · {{ item.rarity || item.itemType || 'NFT' }}</span>
              </div>
              <span>x{{ item.quantity || 1 }}</span>
            </div>
          </div>
        </article>

        <article id="custom-listings" class="sv-panel sv-option-panel">
          <header class="sv-option-head">
            <div>
              <h2>Mes listings</h2>
              <p>{{ myListings.length }} listings actifs</p>
            </div>
            <button type="button" class="sv-mini-action" @click="loadListings">Rafraichir</button>
          </header>

          <div v-if="myListings.length === 0" class="sv-option-empty">Aucun listing actif pour ce wallet.</div>
          <div v-else class="sv-option-list">
            <div v-for="row in myListings.slice(0, 6)" :key="row.listing" class="sv-option-row">
              <img v-if="row.shipImage" :src="row.shipImage" :alt="row.shipName" loading="lazy" />
              <div>
                <strong>{{ row.shipName }}</strong>
                <span>{{ formatPrice(row.price, row.quoteSymbol) }} · x{{ row.quantity || 1 }}</span>
              </div>
              <button type="button" class="sv-row-action" :disabled="actionLoading" @click="cancelListing(row)">Annuler</button>
            </div>
          </div>
        </article>

        <article class="sv-panel sv-option-panel">
          <header class="sv-option-head">
            <div>
              <h2>Listings du marche</h2>
              <p>{{ publicListings.length }} listings custom</p>
            </div>
            <button type="button" class="sv-mini-action" @click="loadListings">Rafraichir</button>
          </header>

          <div v-if="publicListings.length === 0" class="sv-option-empty">Aucun listing custom disponible.</div>
          <div v-else class="sv-option-list">
            <div v-for="row in publicListings.slice(0, 6)" :key="row.listing" class="sv-option-row">
              <img v-if="row.shipImage" :src="row.shipImage" :alt="row.shipName" loading="lazy" />
              <div>
                <strong>{{ row.shipName }}</strong>
                <span>{{ shortAddress(row.seller) }} · {{ formatPrice(row.price, row.quoteSymbol) }}</span>
              </div>
              <button type="button" class="sv-row-action" :disabled="actionLoading || !wallet" @click="buyListing(row)">Acheter</button>
            </div>
          </div>
        </article>

        <article id="transactions" class="sv-panel sv-option-panel">
          <header class="sv-option-head">
            <div>
              <h2>Transactions</h2>
              <p>Etat des actions de cette session</p>
            </div>
          </header>

          <div class="sv-transaction-list">
            <p v-if="actionLoading" class="sv-message">Transaction en cours...</p>
            <p v-if="success" class="sv-message success">{{ success }}</p>
            <p v-if="error" class="sv-message error">{{ error }}</p>
            <p v-if="!actionLoading && !success && !error" class="sv-option-empty">Aucune transaction lancee dans cette session.</p>
          </div>
        </article>
      </section>
    </section>
    </section>
  </main>
</template>
