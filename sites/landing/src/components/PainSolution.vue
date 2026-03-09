<script setup lang="ts">
</script>

<template>
  <section class="py-24 lg:py-32 bg-bg">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
        <!-- Pain -->
        <div class="fade-in-up">
          <div class="text-text-muted font-mono text-sm tracking-wider uppercase mb-4">
            The Problem
          </div>
          <h2 class="text-3xl lg:text-[2.5rem] font-bold leading-tight mb-6">
            Today, AI agents can't pay for anything.
          </h2>
          <div class="space-y-4 text-text-muted text-lg leading-relaxed">
            <p>
              They need human-managed API keys. They can't hold money.
              They can't buy data, compute, or services autonomously.
            </p>
            <p>
              Every transaction flows through Stripe, AWS, or a centralized API gateway.
            </p>
            <p class="text-text font-semibold">
              30% platform fees. Account creation. Subscription lock-in.
            </p>
          </div>
        </div>

        <!-- Solution -->
        <div class="fade-in-up relative">
          <!-- Subtle left border on desktop -->
          <div class="hidden lg:block absolute -left-10 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-brand/30 to-transparent"></div>

          <div class="text-brand font-mono text-sm tracking-wider uppercase mb-4">
            The Solution
          </div>
          <h2 class="text-3xl lg:text-[2.5rem] font-bold leading-tight mb-6">
            <span class="text-brand">SweeFi</span>: HTTP 402 + Sui =<br>
            autonomous agent commerce.
          </h2>
          <div class="space-y-4 text-text-muted text-lg leading-relaxed">
            <p>
              An agent discovers a paid API. The server responds HTTP 402 with its price.
              The agent pays on-chain. The server delivers.
            </p>
            <p>
              No account. No API key. No subscription. No platform.
            </p>
            <p class="text-brand font-semibold">
              The HTTP endpoint IS the business.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
