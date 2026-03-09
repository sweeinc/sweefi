<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  agentHtml, serverHtml, mcpHtml, cliHtml,
  agentPlain, serverPlain, mcpPlain, cliPlain,
} from '../generated/highlights'

const activeTab = ref(0)
const copied = ref(false)

const tabs = [
  { label: 'AI Agent', html: agentHtml, plain: agentPlain },
  { label: 'API Provider', html: serverHtml, plain: serverPlain },
  { label: 'MCP (Claude)', html: mcpHtml, plain: mcpPlain },
  { label: 'CLI', html: cliHtml, plain: cliPlain },
]

const mcpNote = '35 tools. Claude discovers pricing, pays autonomously, self-recovers from errors.'

const currentTab = computed(() => tabs[activeTab.value]!)

function copyCode() {
  navigator.clipboard.writeText(currentTab.value.plain)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <section class="py-24 lg:py-32 bg-surface">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="text-center mb-16 fade-in-up">
        <h2 class="text-3xl lg:text-[2.5rem] font-bold mb-4">Start in Minutes</h2>
        <p class="text-text-muted text-lg">Four personas. Four code examples. Copy, paste, build.</p>
      </div>

      <div class="fade-in-up max-w-3xl mx-auto">
        <!-- Tabs - desktop -->
        <div class="hidden sm:flex border-b border-border mb-0">
          <button
            v-for="(tab, i) in tabs"
            :key="tab.label"
            @click="activeTab = i; copied = false"
            class="px-5 py-3 text-sm font-medium transition-colors relative"
            :class="activeTab === i
              ? 'text-brand'
              : 'text-text-muted hover:text-text'"
          >
            {{ tab.label }}
            <div
              v-if="activeTab === i"
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-brand"
            ></div>
          </button>
        </div>

        <!-- Tabs - mobile dropdown -->
        <div class="sm:hidden mb-4">
          <select
            v-model.number="activeTab"
            class="w-full bg-code-bg border border-border rounded-lg px-4 py-3 text-text font-medium appearance-none cursor-pointer"
          >
            <option v-for="(tab, i) in tabs" :key="tab.label" :value="i">
              {{ tab.label }}
            </option>
          </select>
        </div>

        <!-- Code block -->
        <div class="code-block-wrap relative">
          <div class="bg-code-bg rounded-b-xl sm:rounded-t-none rounded-t-xl border border-border sm:border-t-0 overflow-hidden">
            <pre class="p-5 text-sm font-mono leading-relaxed overflow-x-auto"><code v-html="currentTab.html"></code></pre>
            <!-- Copy button -->
            <button
              @click="copyCode"
              class="copy-btn absolute top-3 right-3 px-2.5 py-1.5 bg-surface border border-border rounded text-xs font-mono text-text-muted hover:text-text hover:border-brand transition-all"
            >
              {{ copied ? 'Copied!' : 'Copy' }}
            </button>
          </div>

          <!-- MCP note -->
          <p
            v-if="activeTab === 2"
            class="mt-3 text-sm text-text-muted italic text-center"
          >
            {{ mcpNote }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
