<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../services/api.js';

const loading = ref(true);
const error = ref('');
const shipCount = ref(0);

onMounted(async () => {
  try {
    const data = await api.getShips();
    shipCount.value = data.ships?.length || 0;
  } catch (err) {
    error.value = err.message || 'Impossible de charger le catalogue.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="app-shell marketplace-shell">
    <section class="panel marketplace-panel">
      <div class="panel-head marketplace-head">
        <div>
          <p class="eyebrow">STAR OPTIQUE</p>
          <h2>Accueil marketplace</h2>
          <p class="muted">
            Accede a ton catalogue Star Atlas, ouvre ton marketplace custom, connecte Phantom et gere tes NFTs.
          </p>
        </div>
        <div class="marketplace-actions-bar">
          <router-link class="badge-button linklike" to="/marketplace">Ouvrir le marketplace</router-link>
          <router-link class="badge-button linklike" to="/orders/sellers">Voir les ventes Star Atlas</router-link>
        </div>
      </div>

      <p v-if="loading" class="loading-view">Chargement de l accueil…</p>
      <p v-else-if="error" class="marketplace-message error">{{ error }}</p>
      <div v-else class="marketplace-grid">
        <section class="marketplace-column">
          <article class="marketplace-card panel">
            <div class="marketplace-card-body">
              <strong>Mon marketplace NFT</strong>
              <span class="muted">Affiche tes NFTs, mets-les en vente, annule un listing ou achete ceux des autres via ton programme.</span>
              <router-link class="badge-button linklike" to="/marketplace">Entrer</router-link>
            </div>
          </article>
        </section>

        <section class="marketplace-column">
          <article class="marketplace-card panel">
            <div class="marketplace-card-body">
              <strong>Catalogue disponible</strong>
              <span class="muted">{{ shipCount }} vaisseaux charges depuis les donnees Star Atlas.</span>
              <router-link class="badge-button linklike" to="/orders/sellers">Comparer avec le marche Star Atlas</router-link>
            </div>
          </article>
        </section>
      </div>
    </section>
  </main>
</template>
