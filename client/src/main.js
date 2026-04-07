import { createApp } from 'vue';
import { Buffer } from 'buffer';
import App from './App.vue';
import router from './router/index.js';
import './assets/styles.css';

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

createApp(App).use(router).mount('#app');
