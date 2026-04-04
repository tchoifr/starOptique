import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import ShipView from '../views/ShipView.vue';
import SellersView from '../views/SellersView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/ships/:mint', name: 'ship', component: ShipView, props: true },
    { path: '/orders/sellers', name: 'sellers', component: SellersView },
  ],
});

export default router;
