<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../services/api.js';

const route = useRoute();
const router = useRouter();
const PER_PAGE = 25;
const loading = ref(true);
const error = ref('');
const rows = ref([]);
const pagination = ref({ page: 1, perPage: PER_PAGE, total: null, totalPages: null, hasNextPage: false, scannedShips: 0, totalShips: 0 });
const progressiveLoading = ref(false);
let refreshTimer = null;

const sellerMode = computed(() => route.query.mode === 'lowest-per-ship' ? 'lowest-per-ship' : 'all');

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function shouldKeepRefreshing() {
  return pagination.value.hasNextPage && (
    rows.value.length < pagination.value.perPage ||
    (pagination.value.totalShips > 0 && pagination.value.scannedShips < pagination.value.totalShips)
  );
}

function scheduleRefresh(delayMs = 1500) {
  clearRefreshTimer();
  if (!shouldKeepRefreshing()) {
    progressiveLoading.value = false;
    return;
  }

  progressiveLoading.value = true;
  refreshTimer = setTimeout(() => {
    loadSilently();
  }, delayMs);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const page = Number(route.query.page || 1);
    const data = await api.getSellers(page, PER_PAGE, sellerMode.value);
    rows.value = data.rows || [];
    pagination.value = data.pagination || pagination.value;
  } catch (err) {
    error.value = err.message || 'Erreur de chargement';
  } finally {
    loading.value = false;
  }

  scheduleRefresh();
}

async function loadSilently() {
  try {
    const page = Number(route.query.page || 1);
    const data = await api.getSellers(page, PER_PAGE, sellerMode.value);
    rows.value = data.rows || [];
    pagination.value = data.pagination || pagination.value;
    scheduleRefresh();
  } catch {
    // Keep current data on silent refresh failures.
    scheduleRefresh(2500);
  }
}

function goToPage(page) {
  router.replace({ query: { ...route.query, page } });
}

function setSellerMode(mode) {
  const nextMode = mode === 'lowest-per-ship' ? 'lowest-per-ship' : 'all';
  router.replace({
    query: {
      ...(nextMode === 'lowest-per-ship' ? { mode: nextMode } : {}),
      page: 1,
    },
  });
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
    return;
  }

  router.push('/');
}

watch(() => [route.query.page, route.query.mode], load, { immediate: true });
onBeforeUnmount(() => {
  clearRefreshTimer();
});
</script>

<template>
  <main class="app-shell sellers-shell">
    <section class="panel sellers-panel">
      <div class="panel-head sellers-head">
        <div>
          <p class="eyebrow">ORDRES VENDEURS</p>
          <h2>Tous les navires en vente</h2>
          <p class="muted">Liste des offres USDC triée du prix le plus bas au plus haut, avec option pour ne garder que le vendeur le moins cher par navire.</p>
        </div>
        <div class="marketplace-actions-bar">
          <router-link class="badge-button linklike" to="/marketplace">Mon marketplace</router-link>
          <button type="button" class="badge-button linklike" @click="goBack">Retour détail</button>
        </div>
      </div>

      <div v-if="loading" class="loading-view">Chargement…</div>
      <div v-else-if="error" class="loading-view error">{{ error }}</div>
      <div v-else>
        <div class="seller-mode-toggle" role="tablist" aria-label="Filtre vendeurs">
          <button type="button" class="badge-button linklike" :class="{ active: sellerMode === 'all' }" @click="setSellerMode('all')">
            Tous les vendeurs
          </button>
          <button type="button" class="badge-button linklike" :class="{ active: sellerMode === 'lowest-per-ship' }" @click="setSellerMode('lowest-per-ship')">
            Moins cher par navire
          </button>
        </div>
        <div class="orders-header sell standalone">
          <strong>{{ sellerMode === 'lowest-per-ship' ? 'Prix le plus bas par navire' : 'Liste des navires en vente' }}</strong>
          <span>{{ pagination.total ?? rows.length }} lignes</span>
        </div>
        <p v-if="progressiveLoading" class="muted sellers-progress">
          Chargement progressif… {{ pagination.scannedShips }}/{{ pagination.totalShips || '?' }} navires scannes.
        </p>
        <div class="sellers-list">
          <router-link v-for="row in rows" :key="`${row.shipMint}-${row.owner}-${row.price}-${row.createdAtIso}`" :to="`/ships/${row.shipMint}`" class="seller-card">
            <img :src="row.shipImage" :alt="row.shipName" />
            <div class="seller-main">
              <strong>{{ row.shipName }}</strong>
              <span>{{ row.owner ? `${row.owner.slice(0, 4)}...${row.owner.slice(-4)}` : 'catalogue' }}</span>
            </div>
            <span>{{ row.remainingQty ?? '—' }}</span>
            <strong>{{ Number(row.price).toFixed(2) }} USDC</strong>
            <span>{{ row.createdAtIso ? new Date(row.createdAtIso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'n/a' }}</span>
          </router-link>
        </div>

        <div class="pagination-bar" v-if="pagination.page > 1 || pagination.hasNextPage">
          <button class="badge-button" :disabled="pagination.page <= 1" @click="goToPage(pagination.page - 1)">Page précédente</button>
          <span class="badge-button static">Page {{ pagination.page }}</span>
          <button class="badge-button" :disabled="!pagination.hasNextPage" @click="goToPage(pagination.page + 1)">Page suivante</button>
        </div>
      </div>
    </section>
  </main>
</template>
