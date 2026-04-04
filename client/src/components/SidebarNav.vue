<script setup>
defineProps({
  groupedShips: { type: Array, required: true },
  currentMint: { type: String, default: '' },
  selectedSort: { type: String, default: 'name' },
});

const rarityLabels = {
  legendary: 'légendaire',
  epic: 'épique',
  rare: 'rare',
  uncommon: 'peu commun',
  common: 'commun',
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
</script>

<template>
  <aside class="market-sidebar panel official-sidebar-shell">
    <div class="sidebar-title-row">
      <span class="sidebar-title">Navires</span>
    </div>

    <nav class="sidebar-sections official-sidebar-sections">
      <details class="sidebar-section-open official-open-section" open>
        <summary>
          <span class="sidebar-chevron">⌄</span>
          <span>Navires</span>
        </summary>

        <div class="sidebar-groups official-like">
          <details
            v-for="group in groupedShips"
            :key="group.key || group.label"
            class="ship-size-group official-size-group"
            :open="group.items.some((item) => item.mint === currentMint)"
          >
            <summary>
              <span class="sidebar-chevron">›</span>
              <span>{{ group.label }}</span>
            </summary>

            <div class="ship-size-items official-size-items">
              <router-link
                v-for="ship in group.items"
                :key="ship.mint"
                :to="{ name: 'ship', params: { mint: ship.mint }, query: { sort: selectedSort } }"
                class="ship-link official compact-ship-link"
                :class="{ active: ship.mint === currentMint }"
              >
                <img :src="ship.image" :alt="ship.name" loading="lazy" />
                <div class="ship-copy compact-copy">
                  <strong :title="ship.name">{{ ship.name }}</strong>
                  <span>{{ formatSpec(ship.spec) }} · {{ formatRarity(ship.rarity) }}</span>
                </div>
              </router-link>
            </div>
          </details>
        </div>
      </details>
    </nav>
  </aside>
</template>
