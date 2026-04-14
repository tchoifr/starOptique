<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../services/api.js';
import { connectPhantom, disconnectPhantom, getPhantomProvider } from '../services/phantom.js';
import {
  buyNftWithPhantom,
  cancelNftListingWithPhantom,
  listNftWithPhantom,
} from '../services/customMarketplace.js';

const marketConfig = ref(null);
const listings = ref([]);
const wallet = ref('');
const walletItems = ref([]);
const devnetWalletItems = ref([]);
const error = ref('');
const success = ref('');
const loading = ref(true);
const walletLoading = ref(false);
const actionLoading = ref(false);
const priceInputs = ref({});
const quantityInputs = ref({});
let phantomAccountChangedHandler = null;
let phantomDisconnectHandler = null;

const myListings = computed(() => listings.value.filter((row) => row.seller === wallet.value));
const publicListings = computed(() => listings.value.filter((row) => row.seller !== wallet.value));
const walletUnits = computed(() => walletItems.value.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0));
const devnetWalletUnits = computed(() => devnetWalletItems.value.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0));

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

function ensurePriceInputs(items) {
  for (const item of items) {
    if (!priceInputs.value[item.mint]) {
      priceInputs.value[item.mint] = item.listing?.price ? String(item.listing.price) : '';
    }
    if (!quantityInputs.value[item.mint]) {
      quantityInputs.value[item.mint] = item.listing?.quantity
        ? String(item.listing.quantity)
        : String(item.maxListableQuantity || item.quantity || 1);
    }
  }
}

async function loadWalletInventories() {
  if (!wallet.value) {
    walletItems.value = [];
    devnetWalletItems.value = [];
    return;
  }

  walletLoading.value = true;
  try {
    const [mainnetData, devnetData] = await Promise.all([
      api.getWalletNfts(wallet.value),
      api.getDevnetWalletNfts(wallet.value),
    ]);

    walletItems.value = mainnetData.items || [];
    devnetWalletItems.value = devnetData.items || [];
    ensurePriceInputs(devnetWalletItems.value);

    if (mainnetData.partial || devnetData.partial) {
      error.value = 'Inventaire charge partiellement. Certaines donnees annexes n ont pas repondu.';
    }
  } catch (err) {
    error.value = err.message || 'Impossible de rafraichir les inventaires du wallet.';
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
    devnetWalletItems.value = [];
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
  devnetWalletItems.value = [];
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

function toWholeQuantity(quantityText) {
  const value = Number(String(quantityText || '').replace(',', '.'));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Quantite invalide.');
  }
  return BigInt(value);
}

function pickSourceTokenAccount(item, quantity) {
  const accounts = Array.isArray(item?.tokenAccounts) ? item.tokenAccounts : [];
  if (accounts.length === 0) {
    return item?.sourceTokenAccount || null;
  }

  const preferredAddress = String(item?.sourceTokenAccount || '').trim();
  const matching = accounts
    .filter((account) => {
      try {
        return BigInt(account?.quantity || 0) >= quantity;
      } catch {
        return false;
      }
    })
    .sort((left, right) =>
      Number(String(right?.address || '') === preferredAddress) - Number(String(left?.address || '') === preferredAddress) ||
      Number(right?.quantity || 0) - Number(left?.quantity || 0),
    );

  if (matching[0]?.address) {
    return matching[0].address;
  }

  const maxListableQuantity = Number(item?.maxListableQuantity || item?.sourceQuantity || 0);
  if (maxListableQuantity > 0) {
    throw new Error(`Ce mint est reparti sur plusieurs token accounts. Quantite max par listing direct: ${maxListableQuantity}.`);
  }

  throw new Error('Impossible d identifier le token account source pour ce mint.');
}

async function submitListing(item) {
  resetMessages();
  actionLoading.value = true;
  try {
    await syncWalletFromProvider();
    const priceBaseUnits = toBaseUnits(priceInputs.value[item.mint]);
    const quantity = toWholeQuantity(quantityInputs.value[item.mint]);
    const sellerTokenAccount = pickSourceTokenAccount(item, quantity);
    const signature = await listNftWithPhantom({
      nftMint: item.mint,
      priceBaseUnits,
      quantity,
      sellerTokenAccount,
    });
    success.value = `Listing cree: ${signature}`;
    await refreshAll();
  } catch (err) {
    error.value = err.message || 'Impossible de creer le listing.';
  } finally {
    actionLoading.value = false;
  }
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
        devnetWalletItems.value = [];
        return;
      }
      await refreshAll();
    };

    phantomDisconnectHandler = () => {
      wallet.value = '';
      walletItems.value = [];
      devnetWalletItems.value = [];
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
          <router-link class="badge-button linklike" to="/orders/sellers">Ordres Star Atlas</router-link>
          <button v-if="!wallet" type="button" class="badge-button" @click="connectWallet()">Connecter Phantom</button>
          <button v-else type="button" class="badge-button" @click="disconnectWalletAction">{{ shortAddress(wallet) }}</button>
          <button type="button" class="badge-button" @click="refreshAll">Rafraichir</button>
        </div>
      </div>

      <p v-if="marketConfig" class="muted marketplace-meta">
        Programme custom: {{ shortAddress(marketConfig.programId) }} · Fee: {{ marketConfig.platformFeeBps / 100 }}% · Quote: {{ marketConfig.quoteSymbol }} · Inventaire reel sur mainnet-beta · Marketplace custom sur devnet
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
          <div class="orders-header sell standalone">
            <strong>Mes NFTs devnet</strong>
            <span>{{ wallet ? devnetWalletItems.length : 0 }} mints · {{ devnetWalletUnits }} unites</span>
          </div>
          <div v-if="!wallet" class="loading-view">Connecte Phantom pour charger ton inventaire devnet.</div>
          <div v-else-if="walletLoading" class="loading-view">Chargement des NFTs devnet…</div>
          <div v-else-if="devnetWalletItems.length === 0" class="loading-view">Aucun NFT devnet trouve sur ce wallet.</div>
          <div v-else class="marketplace-card-list">
            <article v-for="item in devnetWalletItems" :key="item.mint" class="marketplace-card panel">
              <img v-if="item.image" :src="item.image" :alt="item.name" class="marketplace-card-image" />
              <div class="marketplace-card-body">
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ item.manufacturer || item.category || 'Custom devnet' }} · {{ item.rarity || item.itemType || 'nft' }}</span>
                <span class="muted">Quantite: {{ item.quantity || 1 }}</span>
                <span class="muted">Mint: {{ shortAddress(item.mint) }}</span>
                <span v-if="item.tokenAccounts?.length > 1" class="muted">
                  Listing direct max: {{ item.maxListableQuantity || item.quantity || 1 }} (reparti sur {{ item.tokenAccounts.length }} comptes)
                </span>
                <span class="muted">
                  Star Atlas floor: {{ formatPrice(item.market?.floor, item.market?.floorQuoteSymbol || 'USDC') }}
                </span>
                <div class="marketplace-inline-form">
                  <input
                    v-model="quantityInputs[item.mint]"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Quantite"
                  />
                  <input
                    v-model="priceInputs[item.mint]"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Prix USDC"
                  />
                  <button
                    type="button"
                    class="badge-button"
                    :disabled="actionLoading"
                    @click="submitListing(item)"
                  >
                    Mettre en vente
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section class="marketplace-column">
          <div class="orders-header buy standalone">
            <strong>Mes listings devnet</strong>
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
            <strong>Listings du marche devnet</strong>
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
