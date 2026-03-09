<script setup lang="ts">
import { ref, onMounted } from 'vue'

const barRef = ref<HTMLElement | null>(null)
const counting = ref(false)

onMounted(() => {
  if (!barRef.value) return
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          counting.value = true
          observer.disconnect()
        }
      })
    },
    { threshold: 0.3 }
  )
  observer.observe(barRef.value)
})

const stats = [
  { counter: 'counter-847', label: 'Tests' },
  { counter: 'counter-10a', label: 'Packages (npm)' },
  { counter: 'counter-10b', label: 'Move Modules' },
  { counter: 'counter-35', label: 'MCP Tools' },
  { counter: 'counter-5', label: 'Payment Schemes' },
]
</script>

<template>
  <section ref="barRef" class="py-16 lg:py-20 bg-surface border-y border-border">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="numbers-scroll flex flex-nowrap lg:flex-wrap justify-between gap-8 lg:gap-4">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="flex-shrink-0 text-center min-w-[120px]"
        >
          <div
            class="text-5xl lg:text-6xl font-extrabold text-text tabular-nums"
            :class="[stat.counter, { counting }]"
          ></div>
          <div class="text-sm text-text-muted mt-2 font-medium">{{ stat.label }}</div>
        </div>
        <!-- Apache 2.0 (no counter, just static) -->
        <div class="flex-shrink-0 text-center min-w-[120px]">
          <div class="text-3xl lg:text-4xl font-extrabold text-text leading-[3rem] lg:leading-[3.75rem]">
            <span :class="{ 'opacity-0': !counting, 'opacity-100 transition-opacity duration-1000': counting }">
              Apache 2.0
            </span>
          </div>
          <div class="text-sm text-text-muted mt-2 font-medium">License</div>
        </div>
      </div>
    </div>
  </section>
</template>
