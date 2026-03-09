<script setup lang="ts">
const rows = [
  {
    feature: 'Settlement',
    x402: 'Verify first, settle later (temporal gap)',
    s402: 'Atomic PTBs (no gap)',
    advantage: true,
  },
  {
    feature: 'Payment modes',
    x402: 'Exact only',
    s402: 'Exact, Prepaid, Escrow, Stream, Seal',
    advantage: true,
  },
  {
    feature: 'Micro-payment gas',
    x402: '~$1.00 per 1K calls (Base L2)',
    s402: '$0.014 per 1K calls (prepaid batching)',
    advantage: true,
  },
  {
    feature: 'Agent authorization',
    x402: 'None',
    s402: 'AP2 Mandates (spending limits + revocation)',
    advantage: true,
  },
  {
    feature: 'Content gating',
    x402: 'Server-trust (access control)',
    s402: 'Trustless (SEAL threshold encryption)',
    advantage: true,
  },
  {
    feature: 'Finality',
    x402: '~12s (L1) / ~2s (L2)',
    s402: '~400ms',
    advantage: true,
  },
  {
    feature: 'Facilitator',
    x402: 'Required (trust bottleneck)',
    s402: 'Optional (direct settlement available)',
    advantage: true,
  },
  {
    feature: 'Receipts',
    x402: 'Off-chain',
    s402: 'On-chain NFTs (composable)',
    advantage: true,
  },
  {
    feature: 'Security model',
    x402: 'Sign-first (facilitator holds signed txs)',
    s402: 'Settle-first (atomic on-chain)',
    advantage: true,
  },
  {
    feature: 'Source code',
    x402: 'Open source',
    s402: 'Open source (Apache 2.0 + patent grant)',
    advantage: false,
  },
  {
    feature: 'Self-hostable',
    x402: 'Yes',
    s402: 'Yes (Docker + Fly.io)',
    advantage: false,
  },
]
</script>

<template>
  <section class="py-24 lg:py-32 bg-bg">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="text-center mb-16 fade-in-up">
        <h2 class="text-3xl lg:text-[2.5rem] font-bold mb-4">s402 vs x402</h2>
        <p class="text-text-muted text-lg max-w-2xl mx-auto">
          SweeFi extends and improves the x402 protocol for Sui's unique capabilities.
        </p>
      </div>

      <div class="fade-in-up comparison-wrap">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b border-border">
              <th class="py-4 px-4 text-sm font-semibold text-text-muted uppercase tracking-wider">Feature</th>
              <th class="py-4 px-4 text-sm font-semibold text-text-muted uppercase tracking-wider">x402 (EVM)</th>
              <th class="py-4 px-4 text-sm font-semibold text-brand uppercase tracking-wider">
                s402 (Sui)
                <span class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-brand/10 text-brand border border-brand/20 normal-case tracking-normal">
                  SweeFi
                </span>
              </th>
            </tr>
          </thead>
          <tbody class="stagger-children">
            <tr
              v-for="row in rows"
              :key="row.feature"
              class="fade-in-up border-b border-border/50 hover:bg-surface/50 transition-colors"
            >
              <td class="py-4 px-4 text-sm font-medium text-text whitespace-nowrap">
                {{ row.feature }}
              </td>
              <td class="py-4 px-4 text-sm text-text-muted">
                {{ row.x402 }}
              </td>
              <td class="py-4 px-4 text-sm" :class="row.advantage ? 'text-brand font-medium' : 'text-text'">
                <span v-if="row.advantage" class="mr-1.5 text-success">&#10003;</span>
                {{ row.s402 }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
