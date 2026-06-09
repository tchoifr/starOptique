<script setup>
import { computed, ref } from 'vue';
import logoImage from '../assets/logo.png';

const props = defineProps({
  groupedShips: { type: Array, required: true },
  currentMint: { type: String, default: '' },
  selectedSort: { type: String, default: 'name' },
});

const emit = defineEmits(['change-sort']);
const searchQuery = ref('');
const selectedClass = ref('all');
const selectedRarity = ref('all');

const rarityLabels = {
  legendary: 'légendaire',
  epic: 'épique',
  rare: 'rare',
  uncommon: 'peu commun',
  common: 'commun',
};

const rarityDisplay = {
  legendary: 'Legendary',
  epic: 'Epic',
  rare: 'Rare',
  uncommon: 'Uncommon',
  common: 'Common',
};

const specLabels = {
  'bounty-hunter': 'chasseur de primes',
  'bounty hunter': 'chasseur de primes',
  miner: 'mineur',
  fighter: 'chasseur',
  freighter: 'cargo',
  'multi-role': 'multi-rôle',
  'multi role': 'multi-rôle',
  racer: 'racer',
  repair: 'réparation',
  rescue: 'sauvetage',
  salvage: 'récupération',
  'data-runner': 'messager de données',
  'data runner': 'messager de données',
  bomber: 'bombardier',
};

function formatSpec(value) {
  return specLabels[value] || value || 'vaisseau';
}

function formatRarity(value) {
  return rarityLabels[value] || value || 'commun';
}

function formatPrice(ship) {
  const value = ship?.market?.floor ?? ship?.market?.vwap ?? ship?.market?.msrp;
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Prix indisponible';
  return `${value.toFixed(2)} ${ship?.market?.floorQuoteSymbol || ship?.market?.msrpSymbol || 'USDC'}`;
}

function updateSort(event) {
  emit('change-sort', event.target.value === 'rarity' ? 'rarity' : 'name');
}

const classOptions = computed(() => props.groupedShips.map((group) => ({
  value: group.key,
  label: group.label,
})));

const ships = computed(() => props.groupedShips.flatMap((group) =>
  group.items.map((ship) => ({
    ...ship,
    sizeKey: group.key,
    sizeLabel: group.label,
  })),
));

const rarityOptions = computed(() => {
  const values = [...new Set(ships.value.map((ship) => ship.rarity).filter(Boolean))];
  return values.sort().map((value) => ({
    value,
    label: rarityDisplay[value] || value,
  }));
});

const filteredShips = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return ships.value.filter((ship) => {
    const matchesQuery = !query || [
      ship.name,
      ship.manufacturer,
      ship.spec,
      ship.rarity,
      ship.sizeLabel,
    ].some((value) => String(value || '').toLowerCase().includes(query));
    const matchesClass = selectedClass.value === 'all' || ship.sizeKey === selectedClass.value;
    const matchesRarity = selectedRarity.value === 'all' || ship.rarity === selectedRarity.value;
    return matchesQuery && matchesClass && matchesRarity;
  });
});
</script>

<template>
  <aside class="market-sidebar panel catalog-shell">
    <div class="catalog-sidebar-head">
      <div class="catalog-title-lockup">
        <img :src="logoImage" alt="" class="catalog-logo" />
        <div>
          <span class="catalog-brand">StarVision</span>
          <strong>Catalogue des vaisseaux</strong>
        </div>
      </div>
      <router-link class="catalog-mini-link" to="/marketplace">Marketplace</router-link>
    </div>

    <div class="catalog-search-wrap">
      <input v-model="searchQuery" type="search" class="catalog-search" placeholder="Rechercher un vaisseau..." />
    </div>

    <div class="catalog-filters">
      <select v-model="selectedClass" class="catalog-select" aria-label="Classe">
        <option value="all">Classe</option>
        <option v-for="option in classOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select v-model="selectedRarity" class="catalog-select" aria-label="Rareté">
        <option value="all">Rareté</option>
        <option v-for="option in rarityOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select :value="selectedSort" class="catalog-select" aria-label="Trier par" @change="updateSort">
        <option value="name">Nom</option>
        <option value="rarity">Rareté</option>
      </select>
    </div>

    <nav class="catalog-card-grid" aria-label="Catalogue des vaisseaux">
      <router-link
        v-for="ship in filteredShips"
        :key="ship.mint"
        :to="{ name: 'ship', params: { mint: ship.mint }, query: { sort: selectedSort } }"
        class="catalog-card"
        :class="{ active: ship.mint === currentMint }"
      >
        <span class="rarity-chip" :data-rarity="ship.rarity">{{ rarityDisplay[ship.rarity] || ship.rarity }}</span>
        <img :src="ship.image" :alt="ship.name" loading="lazy" />
        <strong :title="ship.name">{{ ship.name }}</strong>
        <span>{{ formatRarity(ship.rarity) }} · {{ formatSpec(ship.spec) }}</span>
        <b>{{ formatPrice(ship) }}</b>
      </router-link>

      <div v-if="filteredShips.length === 0" class="catalog-empty">Aucun vaisseau trouve.</div>
    </nav>
  </aside>
</template>
