<script setup lang="ts">
import { ref } from 'vue'
import { heroHtml, heroPlain } from '../generated/highlights'

const copied = ref(false)

function copyCode() {
  navigator.clipboard.writeText(heroPlain)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <section class="hero-bg min-h-screen flex items-center relative overflow-hidden pt-16">
    <div class="max-w-[1200px] mx-auto px-6 py-20 w-full">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <!-- Left: Copy -->
        <div class="fade-in-up visible">
          <h1 class="text-4xl sm:text-5xl lg:text-[4rem] font-extrabold leading-tight tracking-tight mb-6">
            Your AI agent needs a wallet.<br>
            <span class="text-text-muted">Not an API key.</span>
          </h1>
          <p class="text-lg text-text-muted leading-relaxed max-w-xl mb-10">
            Open-source payment infrastructure for Sui.
            AI agents that pay, stream, escrow, and prove — natively on-chain.
          </p>
          <div class="flex flex-wrap gap-4">
            <a
              href="https://docs.sweefi.xyz/guide/quickstart-agent"
              class="btn-glow inline-flex items-center px-6 py-3 bg-brand text-bg font-semibold rounded-lg transition-all hover:brightness-110"
            >
              Get Started
              <svg class="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="https://github.com/sweeinc/sweefi"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center px-6 py-3 border border-border text-text rounded-lg font-semibold transition-all hover:border-brand hover:text-brand"
            >
              <svg class="mr-2 w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              View on GitHub
            </a>
          </div>
        </div>

        <!-- Right: Code -->
        <div class="fade-in-up visible code-block-wrap relative">
          <!-- Editor chrome -->
          <div class="bg-code-bg rounded-t-xl border border-border border-b-0 px-4 py-3 flex items-center gap-2">
            <div class="flex gap-1.5">
              <div class="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
              <div class="w-3 h-3 rounded-full bg-[#febc2e]"></div>
              <div class="w-3 h-3 rounded-full bg-[#28c840]"></div>
            </div>
            <span class="ml-3 text-text-muted text-xs font-mono">agent.ts</span>
          </div>
          <!-- Code block -->
          <div class="relative bg-code-bg rounded-b-xl border border-border border-t-0 overflow-hidden">
            <pre class="p-5 text-sm font-mono leading-relaxed overflow-x-auto"><code v-html="heroHtml"></code></pre>
            <!-- Copy button -->
            <button
              @click="copyCode"
              class="copy-btn absolute top-3 right-3 px-2.5 py-1.5 bg-surface border border-border rounded text-xs font-mono text-text-muted hover:text-text hover:border-brand transition-all"
            >
              {{ copied ? 'Copied!' : 'Copy' }}
            </button>
          </div>
          <!-- Comment below code -->
          <p class="text-xs text-text-muted mt-3 font-mono text-center">
            // 3 lines. Zero setup. The agent pays for you.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
