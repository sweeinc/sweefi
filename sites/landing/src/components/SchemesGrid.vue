<script setup lang="ts">
const topRow = [
  {
    icon: '\u26A1',
    title: 'Exact',
    subtitle: 'One-shot API payments',
    description: 'Sign, settle, done. x402-compatible.',
    status: 'DEPLOYED',
  },
  {
    icon: '\uD83D\uDCE6',
    title: 'Prepaid',
    subtitle: 'Agent budgets with batch settlement',
    description: 'Deposit once, call thousands of times. ~70x gas savings vs per-call settlement.',
    status: 'DEPLOYED',
  },
  {
    icon: '\uD83D\uDD12',
    title: 'Escrow',
    subtitle: 'Trustless digital commerce',
    description: 'Lock funds. Release on delivery. Refund on deadline. Arbiter disputes.',
    status: 'DEPLOYED',
  },
]

const bottomRow = [
  {
    icon: '\uD83C\uDF0A',
    title: 'Stream',
    subtitle: 'Micropayments with budget caps',
    description: 'Create a payment stream. Rate-limited. Hard budget cap kill switch.',
    status: 'DEPLOYED',
  },
  {
    icon: '\uD83D\uDD11',
    title: 'Seal',
    subtitle: 'Pay-to-decrypt (trustless content gating)',
    description: 'Pay \u2192 receipt \u2192 SEAL key servers release decryption key. No trusted third party.',
    status: 'DEPLOYED',
  },
]
</script>

<template>
  <section class="py-24 lg:py-32 bg-bg">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="text-center mb-16 fade-in-up">
        <h2 class="text-3xl lg:text-[2.5rem] font-bold mb-4">Five Payment Schemes</h2>
        <p class="text-text-muted text-lg">Every mode an autonomous agent needs. All deployed.</p>
      </div>

      <!-- Top row: 3 cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
        <div
          v-for="scheme in topRow"
          :key="scheme.title"
          class="fade-in-up scheme-card bg-surface border border-border rounded-xl p-6 flex flex-col"
        >
          <div class="flex items-start justify-between mb-4">
            <span class="text-3xl">{{ scheme.icon }}</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/20">
              {{ scheme.status }}
            </span>
          </div>
          <h3 class="text-xl font-bold mb-1">{{ scheme.title }}</h3>
          <p class="text-sm text-brand font-medium mb-3">{{ scheme.subtitle }}</p>
          <p class="text-text-muted text-sm leading-relaxed flex-1">{{ scheme.description }}</p>
        </div>
      </div>

      <!-- Bottom row: 2 cards centered -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 mt-5 max-w-[790px] mx-auto stagger-children">
        <div
          v-for="scheme in bottomRow"
          :key="scheme.title"
          class="fade-in-up scheme-card bg-surface border border-border rounded-xl p-6 flex flex-col"
        >
          <div class="flex items-start justify-between mb-4">
            <span class="text-3xl">{{ scheme.icon }}</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/20">
              {{ scheme.status }}
            </span>
          </div>
          <h3 class="text-xl font-bold mb-1">{{ scheme.title }}</h3>
          <p class="text-sm text-brand font-medium mb-3">{{ scheme.subtitle }}</p>
          <p class="text-text-muted text-sm leading-relaxed flex-1">{{ scheme.description }}</p>
        </div>
      </div>

      <!-- Killer line -->
      <div class="mt-12 text-center fade-in-up">
        <p class="text-lg lg:text-xl text-text max-w-3xl mx-auto leading-relaxed">
          <span class="font-semibold">Pay per call. Fund agent budgets. Trade trustlessly. Stream micropayments. Gate content.</span>
          <br>
          <span class="text-text-muted">x402 gives you the first one.</span>
          <span class="text-brand font-semibold"> SweeFi gives you all five.</span>
        </p>
      </div>
    </div>
  </section>
</template>
