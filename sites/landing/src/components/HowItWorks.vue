<script setup lang="ts">
</script>

<template>
  <section class="py-24 lg:py-32 bg-surface">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="text-center mb-16 fade-in-up">
        <h2 class="text-3xl lg:text-[2.5rem] font-bold mb-4">How s402 Works</h2>
        <p class="text-text-muted text-lg max-w-2xl mx-auto">
          SweeFi implements the s402 protocol. Three HTTP round trips. Zero human intervention.
        </p>
      </div>

      <!-- Animated Protocol Flow -->
      <div class="fade-in-up max-w-3xl mx-auto">
        <div class="bg-code-bg rounded-xl border border-border overflow-hidden">
          <!-- Header bar -->
          <div class="px-5 py-3 border-b border-border flex items-center gap-2">
            <div class="flex gap-1.5">
              <div class="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
              <div class="w-3 h-3 rounded-full bg-[#febc2e]"></div>
              <div class="w-3 h-3 rounded-full bg-[#28c840]"></div>
            </div>
            <span class="ml-3 text-text-muted text-xs font-mono">s402 protocol flow</span>
          </div>

          <!-- Steps -->
          <div class="p-6 lg:p-8 space-y-8 stagger-children">
            <!-- Step 1 -->
            <div class="fade-in-up flex gap-4">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center text-brand font-bold text-sm">
                1
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-text font-medium mb-2">Agent requests a paid API endpoint</p>
                <div class="bg-bg/50 rounded-lg px-4 py-2.5 font-mono text-sm text-brand overflow-x-auto">
                  <span class="text-text-muted">$</span> curl -i https://sweefi-demo.fly.dev/api/forecast
                </div>
              </div>
            </div>

            <!-- Arrow -->
            <div class="flex justify-center">
              <svg class="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            <!-- Step 2 -->
            <div class="fade-in-up flex gap-4">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-[#febc2e]/10 border border-[#febc2e]/30 flex items-center justify-center text-[#febc2e] font-bold text-sm">
                2
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-text font-medium mb-2">Server responds 402 Payment Required</p>
                <div class="bg-bg/50 rounded-lg px-4 py-2.5 font-mono text-sm overflow-x-auto">
                  <div class="text-[#febc2e]">&lt; HTTP/1.1 402 Payment Required</div>
                  <div class="text-text-muted">&lt; payment-required: eyJzNDAyVmVyc2lvbiI6IjEi...</div>
                </div>
              </div>
            </div>

            <!-- Arrow -->
            <div class="flex justify-center">
              <svg class="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            <!-- Step 3 -->
            <div class="fade-in-up flex gap-4">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center text-brand font-bold text-sm">
                3
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-text font-medium mb-2">Agent auto-detects s402, signs payment, retries</p>
                <div class="bg-bg/50 rounded-lg px-4 py-2.5 font-mono text-sm overflow-x-auto">
                  <span class="text-brand">&gt; GET /api/forecast</span>
                  <span class="text-text-muted"> + X-PAYMENT header</span>
                </div>
              </div>
            </div>

            <!-- Arrow -->
            <div class="flex justify-center">
              <svg class="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>

            <!-- Step 4 -->
            <div class="fade-in-up flex gap-4">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-success/10 border border-success/30 flex items-center justify-center text-success font-bold text-sm">
                4
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-text font-medium mb-2">Server settles on Sui (~400ms), returns data</p>
                <div class="bg-bg/50 rounded-lg px-4 py-2.5 font-mono text-sm overflow-x-auto">
                  <div class="text-success">&lt; HTTP/1.1 200 OK</div>
                  <div class="text-text-muted">&lt; {"forecast": "sunny", "txDigest": "0x..."}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Stats below -->
        <div class="mt-8 flex flex-wrap justify-center gap-8 text-center">
          <div>
            <div class="text-2xl font-bold text-brand">3</div>
            <div class="text-sm text-text-muted">HTTP round trips</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-brand">0</div>
            <div class="text-sm text-text-muted">Human intervention</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-brand">~400ms</div>
            <div class="text-sm text-text-muted">Settlement</div>
          </div>
          <div>
            <div class="text-2xl font-bold text-brand">~$0.003</div>
            <div class="text-sm text-text-muted">Gas cost</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
