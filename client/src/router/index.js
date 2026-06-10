import { createRouter, createWebHistory } from 'vue-router';
import MarketplaceView from '../views/MarketplaceView.vue';

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    if (to.hash) {
      return { el: to.hash };
    }
    return { top: 0 };
  },
  routes: [
    { path: '/', name: 'home', component: MarketplaceView, alias: '/marketplace' },
    {
      path: '/ships/:mint',
      name: 'ship',
      redirect: (to) => ({
        path: '/',
        query: { ship: to.params.mint },
        hash: '#marketplace',
      }),
    },
    {
      path: '/orders/sellers',
      name: 'sellers',
      redirect: { path: '/', hash: '#vendeurs' },
    },
  ],
});

export default router;
