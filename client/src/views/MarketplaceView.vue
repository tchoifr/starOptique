<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../services/api.js';
import { connectPhantom, disconnectPhantom } from '../services/phantom.js';
import {
  buyNftWithPhantom,
  cancelNftListingWithPhantom,
  listNftWithPhantom,
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
const priceInputs = ref({});

const myListings = computed(() => listings.value.filter((row) => row.seller === wallet.value));
const publicListings = computed(() => listings.value.filter((row) => row.seller !== wallet.value));

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

async function loadWalletInventory() {
  if (!wallet.value) {
    walletItems.value = [];
    return;
  }

  walletLoading.value = true;
  try {
    const data = await api.getWalletNfts(wallet.value);
    walletItems.value = data.items || [];
    for (const item of walletItems.value) {
      if (!priceInputs.value[item.mint]) {
        priceInputs.value[item.mint] = item.listing?.price ? String(item.listing.price) : '';
      }
    }
  } finally {
    walletLoading.value = false;
  }
}

async function refreshAll() {
  loading.value = true;
  try {
    marketConfig.value = await api.getMarketplaceConfig();
    await loadListings();
    if (wallet.value) {
      await loadWalletInventory();
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
    await loadWalletInventory();
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

function toBaseUnits(priceText) {
  const value = Number(String(priceText || '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Prix USDC invalide.');
  }
  const decimals = marketConfig.value?.usdcDecimals ?? 6;
  return BigInt(Math.round(value * 10 ** decimals));
}

async function submitListing(item) {
  resetMessages();
  actionLoading.value = true;
  try {
    const priceBaseUnits = toBaseUnits(priceInputs.value[item.mint]);
    const signature = await listNftWithPhantom({
      nftMint: item.mint,
      priceBaseUnits,
    });
    success.value = `Listing cree: ${signature}`;
    await refreshAll();
  } catch (err) {
    error.value = err.message || 'Impossible de creer le listing.';
  } finally {
    actionLoading.value = false;
  }
}

async function cancelListing(item) {
  resetMessages();
  actionLoading.value = true;
  try {
    const signature = await cancelNftListingWithPhantom({ nftMint: item.mint });
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
    const signature = await buyNftWithPhantom({
      nftMint: row.shipMint,
      seller: row.seller,
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
  await refreshAll();
  await connectWallet({ silent: true });
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
          <router-link class="badge-button linklike" to="/orders/sellers">Ordres Star Atlas</router-link>
          <button v-if="!wallet" type="button" class="badge-button" @click="connectWallet()">Connecter Phantom</button>
          <button v-else type="button" class="badge-button" @click="disconnectWalletAction">{{ shortAddress(wallet) }}</button>
          <button type="button" class="badge-button" @click="refreshAll">Rafraichir</button>
        </div>
      </div>

      <p v-if="marketConfig" class="muted marketplace-meta">
        Programme custom: {{ shortAddress(marketConfig.programId) }} · Fee: {{ marketConfig.platformFeeBps / 100 }}% · Quote: {{ marketConfig.quoteSymbol }}
      </p>
      <p v-if="error" class="marketplace-message error">{{ error }}</p>
      <p v-if="success" class="marketplace-message success">{{ success }}</p>
      <div v-if="loading" class="loading-view">Chargement du marketplace…</div>
      <div v-else class="marketplace-grid">
        <section class="marketplace-column">
          <div class="orders-header sell standalone">
            <strong>Mes NFTs</strong>
            <span>{{ wallet ? walletItems.length : 0 }} items</span>
          </div>
          <div v-if="!wallet" class="loading-view">Connecte Phantom pour charger ton inventaire.</div>
          <div v-else-if="walletLoading" class="loading-view">Chargement des NFTs du wallet…</div>
          <div v-else-if="walletItems.length === 0" class="loading-view">Aucun NFT trouve sur ce wallet.</div>
          <div v-else class="marketplace-card-list">
            <article v-for="item in walletItems" :key="item.mint" class="marketplace-card panel">
              <img v-if="item.image" :src="item.image" :alt="item.name" class="marketplace-card-image" />
              <div class="marketplace-card-body">
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ item.manufacturer || 'Star Atlas' }} · {{ item.rarity || 'nft' }}</span>
                <span class="muted">Mint: {{ shortAddress(item.mint) }}</span>
                <span class="muted">
                  Star Atlas floor: {{ formatPrice(item.market?.floor, item.market?.floorQuoteSymbol || 'USDC') }}
                </span>
                <div class="marketplace-inline-form">
                  <input
                    v-model="priceInputs[item.mint]"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Prix USDC"
                  />
                  <button
                    v-if="!item.listed"
                    type="button"
                    class="badge-button"
                    :disabled="actionLoading"
                    @click="submitListing(item)"
                  >
                    Mettre en vente
                  </button>
                  <button
                    v-else
                    type="button"
                    class="badge-button"
                    :disabled="actionLoading"
                    @click="cancelListing(item)"
                  >
                    Annuler listing
                  </button>
                </div>
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
                <span class="muted">{{ formatPrice(row.price, row.quoteSymbol) }}</span>
                <span class="muted">Floor externe: {{ formatPrice(row.externalFloor, row.externalFloorQuoteSymbol) }}</span>
              </div>
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
