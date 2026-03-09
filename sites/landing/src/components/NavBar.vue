<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const scrolled = ref(false)
const mobileOpen = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 20
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', onScroll))

const links = [
  { label: 'Docs', href: 'https://github.com/sweeinc/sweefi/tree/main/docs', external: true },
  { label: 'GitHub', href: 'https://github.com/sweeinc/sweefi', external: true },
  { label: 'npm', href: 'https://www.npmjs.com/org/sweefi', external: true },
]
</script>

<template>
  <header
    class="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
    :class="scrolled ? 'bg-bg/90 backdrop-blur-lg border-b border-border shadow-lg shadow-black/10' : 'bg-transparent'"
  >
    <nav class="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
      <!-- Brand -->
      <a href="/" class="flex items-center gap-2.5 group">
        <span class="text-2xl font-extrabold tracking-tight text-text group-hover:text-brand transition-colors">
          Swee<span class="text-brand">Fi</span>
        </span>
      </a>

      <!-- Desktop Nav -->
      <div class="hidden md:flex items-center gap-8">
        <a
          v-for="link in links"
          :key="link.label"
          :href="link.href"
          :target="link.external ? '_blank' : undefined"
          :rel="link.external ? 'noopener' : undefined"
          class="text-sm font-medium text-text-muted hover:text-text transition-colors"
        >
          {{ link.label }}
        </a>
        <a
          href="https://github.com/sweeinc/sweefi#quick-start"
          class="inline-flex items-center px-4 py-2 bg-brand text-bg text-sm font-semibold rounded-lg transition-all hover:brightness-110"
        >
          Get Started
        </a>
      </div>

      <!-- Mobile hamburger -->
      <button
        class="md:hidden p-2 text-text-muted hover:text-text transition-colors"
        @click="mobileOpen = !mobileOpen"
        :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
      >
        <svg v-if="!mobileOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </nav>

    <!-- Mobile menu -->
    <div
      v-if="mobileOpen"
      class="md:hidden bg-surface border-b border-border px-6 py-4 space-y-3"
    >
      <a
        v-for="link in links"
        :key="link.label"
        :href="link.href"
        :target="link.external ? '_blank' : undefined"
        :rel="link.external ? 'noopener' : undefined"
        class="block text-sm font-medium text-text-muted hover:text-text transition-colors py-2"
        @click="mobileOpen = false"
      >
        {{ link.label }}
      </a>
      <a
        href="https://github.com/sweeinc/sweefi#quick-start"
        class="block text-center px-4 py-2.5 bg-brand text-bg text-sm font-semibold rounded-lg transition-all hover:brightness-110"
        @click="mobileOpen = false"
      >
        Get Started
      </a>
    </div>
  </header>
</template>
