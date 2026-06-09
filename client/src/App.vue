<script setup>
import headerImage from './assets/starvisionHeader.png';
</script>

<template>
  <div class="starvision-root">
    <section class="starvision-hero-screen" aria-label="StarVision">
      <img :src="headerImage" alt="StarVision" class="starvision-header-image" />
      <div class="starvision-header-shade"></div>
      <a class="starvision-scroll-cue" href="#starvision-content">Explorer l'interface</a>
    </section>

    <div id="starvision-content" class="starvision-content">
      <router-view />
    </div>
  </div>
</template>
