<script setup lang="ts">
import { ref } from 'vue'

const copied = ref(false)

function copyInstall() {
  navigator.clipboard.writeText('npm install @sweefi/sui')
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <section class="py-24 lg:py-32 bg-surface border-t border-border">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <div class="fade-in-up">
        <h2 class="text-3xl lg:text-[2.5rem] font-bold mb-10">Ready to build?</h2>

        <!-- CTA buttons -->
        <div class="flex flex-col sm:flex-row flex-wrap justify-center gap-4 mb-12">
          <a
            href="https://docs.sweefi.xyz/guide/quickstart-agent"
            class="btn-glow inline-flex items-center justify-center px-6 py-3 bg-brand text-bg font-semibold rounded-lg transition-all hover:brightness-110 min-h-[44px]"
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
            class="inline-flex items-center justify-center px-6 py-3 border border-border text-text rounded-lg font-semibold transition-all hover:border-brand hover:text-brand min-h-[44px]"
          >
            <svg class="mr-2 w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View on GitHub
          </a>
          <a
            href="https://docs.sweefi.xyz"
            class="inline-flex items-center justify-center px-6 py-3 border border-border text-text rounded-lg font-semibold transition-all hover:border-brand hover:text-brand min-h-[44px]"
          >
            Read the Docs
          </a>
          <button
            @click="copyInstall"
            class="inline-flex items-center justify-center px-6 py-3 bg-code-bg border border-border rounded-lg font-mono text-sm text-text-muted hover:text-text hover:border-brand transition-all cursor-pointer min-h-[44px]"
          >
            <span class="text-text-muted mr-2">$</span>
            npm install @sweefi/sui
            <svg v-if="!copied" class="ml-3 w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <svg v-else class="ml-3 w-4 h-4 flex-shrink-0 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>

        <!-- Protocol link -->
        <div class="text-sm text-text-muted space-y-2 mb-10">
          <p>
            Built on the
            <a href="https://s402-protocol.org" target="_blank" rel="noopener" class="text-brand hover:underline">
              s402 open protocol
            </a>.
          </p>
          <p>
            Apache 2.0 License &nbsp;|&nbsp; &copy; 2026 Swee Group LLC
          </p>
        </div>

        <!-- Social links -->
        <div class="flex justify-center gap-6">
          <!-- GitHub -->
          <a
            href="https://github.com/sweeinc/sweefi"
            target="_blank"
            rel="noopener"
            class="text-text-muted hover:text-brand transition-colors"
            aria-label="GitHub"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
          <!-- npm -->
          <a
            href="https://www.npmjs.com/org/sweefi"
            target="_blank"
            rel="noopener"
            class="text-text-muted hover:text-brand transition-colors"
            aria-label="npm"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331zM10.665 10H12v2.667h-1.335V10z"/>
            </svg>
          </a>
          <!-- Discord (placeholder) -->
          <a
            href="#"
            class="text-text-muted hover:text-brand transition-colors opacity-50 cursor-default"
            aria-label="Discord (coming soon)"
            title="Coming soon"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
          </a>
          <!-- Twitter/X (placeholder) -->
          <a
            href="#"
            class="text-text-muted hover:text-brand transition-colors opacity-50 cursor-default"
            aria-label="Twitter/X (coming soon)"
            title="Coming soon"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  </section>
</template>
