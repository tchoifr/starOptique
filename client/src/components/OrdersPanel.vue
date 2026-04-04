<script setup>
defineProps({
  shipName: { type: String, required: true },
  asks: { type: Array, required: true },
  bids: { type: Array, required: true },
});

function shortOwner(owner) {
  if (!owner) return 'n/a';
  return `${owner.slice(0, 4)}...${owner.slice(-4)}`;
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatPrice(order) {
  const symbol = order?.quoteSymbol || 'USDC';
  const value = typeof order?.price === 'number' ? order.price.toFixed(2) : '0.00';
  return `${value} ${symbol}`;
}
</script>

<template>
  <section class="market-orders panel">
    <div class="panel-head">
      <div>
        <p class="eyebrow">ORDRES</p>
        <h2>{{ shipName }}</h2>
      </div>
      <div class="orders-actions">
        <span class="currency-pill active">On-chain</span>
        <router-link class="badge-button" to="/orders/sellers">Tous les navires en vente</router-link>
      </div>
    </div>

    <div class="orders-block">
      <div class="orders-header sell">
        <strong>Vendeurs</strong>
        <span>{{ asks.length }} lignes</span>
      </div>
      <div class="orders-table-head">
        <span>Compte</span>
        <span>Qté</span>
        <span>Prix</span>
        <span>Inscrit</span>
      </div>
      <div v-if="asks.length === 0" class="orders-empty">Aucun vendeur on-chain.</div>
      <div v-for="order in asks" :key="order.id" class="order-row">
        <span>{{ shortOwner(order.owner) }}</span>
        <span>{{ order.remainingQty }}</span>
        <strong>{{ formatPrice(order) }}</strong>
        <span>{{ formatDate(order.createdAtIso) }}</span>
      </div>
    </div>

    <div class="orders-block">
      <div class="orders-header buy">
        <strong>Acheteurs</strong>
        <span>{{ bids.length }} lignes</span>
      </div>
      <div class="orders-table-head">
        <span>Compte</span>
        <span>Qté</span>
        <span>Prix</span>
        <span>Inscrit</span>
      </div>
      <div v-if="bids.length === 0" class="orders-empty">Aucun acheteur on-chain.</div>
      <div v-for="order in bids" :key="order.id" class="order-row">
        <span>{{ shortOwner(order.owner) }}</span>
        <span>{{ order.remainingQty }}</span>
        <strong>{{ formatPrice(order) }}</strong>
        <span>{{ formatDate(order.createdAtIso) }}</span>
      </div>
    </div>
  </section>
</template>
