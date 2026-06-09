<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../services/api.js';

const router = useRouter();
const error = ref('');

onMounted(async () => {
  try {
    const data = await api.getShips();
    const first = data.ships?.[0];
    if (first) {
      router.replace({ name: 'ship', params: { mint: first.mint } });
      return;
    }
    error.value = 'Aucun vaisseau disponible.';
  } catch (err) {
    error.value = err.message || 'Impossible de charger le catalogue Star Atlas.';
  }
});
</script>

<template>
  <main class="loading-view" :class="{ error }">
    {{ error || 'Chargement du catalogue…' }}
  </main>
</template>
