<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../services/api.js';
import SidebarNav from '../components/SidebarNav.vue';
import OrdersPanel from '../components/OrdersPanel.vue';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const error = ref('');
const data = ref(null);
const selectedSort = computed(() => route.query.sort === 'rarity' ? 'rarity' : 'name');

const rarityLabels = {
  legendary: 'Légendaire',
  epic: 'Épique',
  rare: 'Rare',
  uncommon: 'Peu commun',
  common: 'Commun',
};

const sizeLabels = {
  'xx-small': 'XX-Small',
  'very-small': 'Très petit',
  small: 'Petit',
  medium: 'Moyen',
  large: 'Grand',
  capital: 'Capital',
  commander: 'Commandant',
  titan: 'Titan',
  unknown: 'Inconnu',
};

const specLabels = {
  'bounty-hunter': 'Chasseur de primes',
  'bounty hunter': 'Chasseur de primes',
  miner: 'Mineur',
  fighter: 'Chasseur',
  freighter: 'Cargo',
  'multi-role': 'Multi-rôle',
  'multi role': 'Multi-rôle',
  racer: 'Racer',
  repair: 'Réparation',
  rescue: 'Sauvetage',
  salvage: 'Récupération',
  'data-runner': 'Messager de données',
  'data runner': 'Messager de données',
  bomber: 'Bombardier',
};

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.getShip(route.params.mint, selectedSort.value);
  } catch (err) {
    error.value = err.message || 'Erreur de chargement';
  } finally {
    loading.value = false;
  }
}

function changeSort(sort) {
  router.replace({ query: { ...route.query, sort } });
}

function formatRarity(value) {
  return rarityLabels[value] || value || 'Inconnu';
}

function formatSize(value) {
  return sizeLabels[value] || value || 'Inconnu';
}

function formatSubtitle(ship) {
  const spec = specLabels[ship.spec] || ship.spec || 'Vaisseau';
  if (ship.manufacturer && ship.manufacturer !== 'Unknown') {
    return `${spec} de ${ship.manufacturer}`;
  }
  return spec;
}

function formatOriginalPrice(ship) {
  if (typeof ship.market?.msrp === 'number' && ship.market.msrp > 0) {
    return `${ship.market.msrp.toFixed(2)} ${ship.market.msrpSymbol || 'USDC'}`;
  }

  if (typeof ship.market?.vwap === 'number' && !Number.isNaN(ship.market.vwap)) {
    return `${ship.market.vwap.toFixed(2)} USDC`;
  }

  return '— USDC';
}

watch(() => [route.params.mint, route.query.sort], load, { immediate: true });
</script>

<template>
  <main class="app-shell">
    <div v-if="loading" class="loading-view">Chargement…</div>
    <div v-else-if="error" class="loading-view error">{{ error }}</div>
    <section v-else class="market-layout refined-layout">
      <SidebarNav
        :grouped-ships="data.groupedShips"
        :current-mint="data.ship.mint"
        :selected-sort="selectedSort"
        @change-sort="changeSort"
      />

      <section class="market-stage refined-stage">
        <div class="panel hero-panel refined-panel">
          <p class="breadcrumb">MAISON / NAVIRES / {{ formatSize(data.ship.size).toUpperCase() }} / {{ data.ship.name.toUpperCase() }}</p>
          <div class="hero-card compact-hero official-hero-card">
            <img :src="data.ship.image" :alt="data.ship.name" class="hero-image" />
            <div class="hero-overlay official-hero-overlay"></div>
            <div class="hero-body official-hero-body">
              <div class="hero-copy-wrap official-copy-wrap">
                <h2>{{ data.ship.name }}</h2>
                <p class="hero-subtitle">{{ formatSubtitle(data.ship) }}</p>
              </div>

              <div class="hero-metadata-row">
                <div class="hero-meta-item">
                  <span>Rareté</span>
                  <strong class="rarity-badge" :data-rarity="data.ship.rarity">{{ formatRarity(data.ship.rarity) }}</strong>
                </div>
                <div class="hero-meta-item">
                  <span>Classe</span>
                  <strong>{{ formatSize(data.ship.size) }}</strong>
                </div>
                <div class="hero-meta-item">
                  <span>Prix d'origine</span>
                  <strong>{{ formatOriginalPrice(data.ship) }}</strong>
                </div>
                <div class="hero-meta-item">
                  <span>Équipage</span>
                  <strong>{{ data.ship.crew ?? '—' }}</strong>
                </div>
              </div>

              <p v-if="data.ship.description" class="hero-description">{{ data.ship.description }}</p>
            </div>
          </div>
        </div>
      </section>

      <OrdersPanel :ship-name="data.ship.name" :asks="data.ship.market.asks" :bids="data.ship.market.bids" />
    </section>
  </main>
</template>
