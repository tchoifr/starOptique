<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../services/api.js';
import { connectPhantom, disconnectPhantom, getPhantomProvider } from '../services/phantom.js';
import {
  buyNftWithPhantom,
  cancelNftListingWithPhantom,
} from '../services/customMarketplace.js';

const marketConfig = ref(null);
const listings = ref([]);
const wallet = ref('');
const walletItems = ref([]);
const error = ref('');
const success = ref('');
const loading = ref(true);
const walletLoading = ref(false);
const actionLoading = ref(false);
let phantomAccountChangedHandler = null;
let phantomDisconnectHandler = null;

const myListings = computed(() => listings.value.filter((row) => row.seller === wallet.value));
const publicListings = computed(() => listings.value.filter((row) => row.seller !== wallet.value));
const walletUnits = computed(() => walletItems.value.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0));

function shortAddress(value) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : 'n/a';
}

function formatPrice(value, symbol = 'USDC') {
  if (typeof value !== 'number' || Number.isNaN(value)) return `— ${symbol}`;
  return `${value.toFixed(2)} ${symbol}`;
}

function resetMessages() {
  error.value = '';
  success.value = '';
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
      error.value = 'Inventaire charge partiellement. Certaines donnees annexes n ont pas repondu.';
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
  try {
    marketConfig.value = await api.getMarketplaceConfig();
    await syncWalletFromProvider();
    await loadListings();
    if (wallet.value) {
      await loadWalletInventories();
    }
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
  <main class="app-shell marketplace-shell">
    <section class="panel marketplace-panel">
      <div class="panel-head marketplace-head">
        <div>
          <p class="eyebrow">CUSTOM MARKETPLACE</p>
          <h2>Ton marche NFT Star Atlas</h2>
          <p class="muted">
            Catalogue et visuels Star Atlas, mais listings, achats et annulations via ton propre programme.
          </p>
        </div>
        <div class="marketplace-actions-bar">
          <router-link class="badge-button linklike" to="/">Catalogue Star Atlas</router-link>
          <router-link class="badge-button linklike" to="/orders/sellers">Ordres Star Atlas</router-link>
          <button v-if="!wallet" type="button" class="badge-button" @click="connectWallet()">Connecter Phantom</button>
          <button v-else type="button" class="badge-button" @click="disconnectWalletAction">{{ shortAddress(wallet) }}</button>
          <button type="button" class="badge-button" @click="refreshAll">Rafraichir</button>
        </div>
      </div>

      <p v-if="marketConfig" class="muted marketplace-meta">
        Programme custom: {{ shortAddress(marketConfig.programId) }} · Fee: {{ marketConfig.platformFeeBps / 100 }}% · Quote: {{ marketConfig.quoteSymbol }} · Inventaire NFT sur mainnet-beta
      </p>
      <p v-if="error" class="marketplace-message error">{{ error }}</p>
      <p v-if="success" class="marketplace-message success">{{ success }}</p>
      <div v-if="loading" class="loading-view">Chargement du marketplace…</div>
      <div v-else class="marketplace-grid">
        <section class="marketplace-column">
          <div class="orders-header sell standalone">
            <strong>Mes NFTs reels</strong>
            <span>{{ wallet ? walletItems.length : 0 }} mints · {{ walletUnits }} unites</span>
          </div>
          <div v-if="!wallet" class="loading-view">Connecte Phantom pour charger ton inventaire.</div>
          <div v-else-if="walletLoading" class="loading-view">Chargement des NFTs mainnet…</div>
          <div v-else-if="walletItems.length === 0" class="loading-view">Aucun NFT mainnet trouve sur ce wallet.</div>
          <div v-else class="marketplace-card-list compact">
            <article v-for="item in walletItems" :key="item.mint" class="marketplace-row panel">
              <img v-if="item.image" :src="item.image" :alt="item.name" class="marketplace-row-image" />
              <div class="marketplace-row-copy">
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ item.manufacturer || item.category || 'Star Atlas' }} · {{ item.rarity || item.itemType || 'nft' }}</span>
                <span class="muted">Quantite: {{ item.quantity || 1 }}</span>
                <span class="muted">Mint: {{ shortAddress(item.mint) }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="marketplace-column">
          <div class="orders-header buy standalone">
            <strong>Mes listings</strong>
            <span>{{ myListings.length }} lignes</span>
          </div>
          <div v-if="myListings.length === 0" class="loading-view">Aucun listing actif pour ce wallet.</div>
          <div v-else class="marketplace-card-list compact">
            <article v-for="row in myListings" :key="row.listing" class="marketplace-row panel">
              <img v-if="row.shipImage" :src="row.shipImage" :alt="row.shipName" class="marketplace-row-image" />
              <div class="marketplace-row-copy">
                <strong>{{ row.shipName }}</strong>
                <span class="muted">Quantite du lot: {{ row.quantity || 1 }}</span>
                <span class="muted">Mint: {{ shortAddress(row.shipMint) }}</span>
                <span class="muted">{{ formatPrice(row.price, row.quoteSymbol) }}</span>
                <span class="muted">Floor externe: {{ formatPrice(row.externalFloor, row.externalFloorQuoteSymbol) }}</span>
              </div>
              <button
                type="button"
                class="badge-button"
                :disabled="actionLoading"
                @click="cancelListing(row)"
              >
                Annuler listing
              </button>
            </article>
          </div>
        </section>

        <section class="marketplace-column">
          <div class="orders-header buy standalone">
            <strong>Listings du marche</strong>
            <span>{{ publicListings.length }} lignes</span>
          </div>
          <div v-if="publicListings.length === 0" class="loading-view">Aucun listing custom actif.</div>
          <div v-else class="marketplace-card-list compact">
            <article v-for="row in publicListings" :key="row.listing" class="marketplace-row panel">
              <img v-if="row.shipImage" :src="row.shipImage" :alt="row.shipName" class="marketplace-row-image" />
              <div class="marketplace-row-copy">
                <strong>{{ row.shipName }}</strong>
                <span class="muted">Vendeur: {{ shortAddress(row.seller) }}</span>
                <span class="muted">Quantite du lot: {{ row.quantity || 1 }}</span>
                <span class="muted">Mint: {{ shortAddress(row.shipMint) }}</span>
                <span class="muted">Prix: {{ formatPrice(row.price, row.quoteSymbol) }}</span>
                <span class="muted">Floor Star Atlas: {{ formatPrice(row.externalFloor, row.externalFloorQuoteSymbol) }}</span>
              </div>
              <button
                type="button"
                class="badge-button"
                :disabled="actionLoading || !wallet"
                @click="buyListing(row)"
              >
                Acheter
              </button>
            </article>
          </div>
        </section>
      </div>
    </section>
  </main>
</template>
