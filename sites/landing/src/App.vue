<script setup lang="ts">
import { onMounted } from 'vue'
import HeroSection from './components/HeroSection.vue'
import PainSolution from './components/PainSolution.vue'
import HowItWorks from './components/HowItWorks.vue'
import SchemesGrid from './components/SchemesGrid.vue'
import NumbersBar from './components/NumbersBar.vue'
import ComparisonTable from './components/ComparisonTable.vue'
import CodeExamples from './components/CodeExamples.vue'
import CtaFooter from './components/CtaFooter.vue'

// IntersectionObserver for scroll animations (< 20 lines)
onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
        }
      })
    },
    { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
  )

  document.querySelectorAll('.fade-in-up:not(.visible)').forEach((el) => {
    observer.observe(el)
  })
})
</script>

<template>
  <main>
    <HeroSection />
    <PainSolution />
    <HowItWorks />
    <SchemesGrid />
    <NumbersBar />
    <ComparisonTable />
    <CodeExamples />
    <CtaFooter />
  </main>
</template>
