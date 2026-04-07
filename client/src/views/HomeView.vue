<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../services/api.js';

const router = useRouter();

onMounted(async () => {
  try {
    const data = await api.getShips();
    const first = data.ships?.[0];
    if (first) {
      router.replace({ name: 'ship', params: { mint: first.mint } });
      return;
    }
  } catch {
  }

  router.replace({ name: 'sellers' });
});
</script>

<template>
  <main class="loading-view">Chargement du catalogue…</main>
</template>
