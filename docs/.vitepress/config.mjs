import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SweeFi',
  description: 'Open-source agentic payment infrastructure for Sui. Five payment schemes. 40 PTB builders. Built for AI agents that spend money autonomously.',
  cleanUrls: true,
  srcExclude: [
    'adr/**',
    'specs/**',
    'SDK-ARCHITECTURE-RESTRUCTURE.md',
    'SEAL-ISSUE-BACKLOG.md',
    'QUICKSTART-INTEGRATORS.md',
    'PROOF-OF-WORK.md',
    'MAINNET-DEPLOYMENT.md',
    'V8-FINAL-AUDIT.md',
    'V8-POST-FIX-AUDIT.md',
    'claude-code-mcp.md',
  ],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'SweeFi — Agentic payments for Sui' }],
    ['meta', { property: 'og:description', content: 'Open-source agentic payment infrastructure for Sui. Five payment schemes. 40 PTB builders. Built for AI agents that spend money autonomously.' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:image', content: '/images/og.png' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/quickstart-agent' },
      { text: 'Packages', link: '/guide/sui' },
      { text: 'Schemes', link: '/guide/exact' },
      { text: 'Contracts', link: '/guide/contracts' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is SweeFi?', link: '/guide/' },
          { text: 'Architecture', link: '/guide/architecture' },
        ],
      },
      {
        text: 'Quick Start',
        items: [
          { text: 'Agent (Client)', link: '/guide/quickstart-agent' },
          { text: 'Server (Provider)', link: '/guide/quickstart-server' },
          { text: 'MCP + Claude Desktop', link: '/guide/mcp-setup' },
          { text: 'Self-Hosting Facilitator', link: '/guide/facilitator' },
        ],
      },
      {
        text: 'Payment Schemes',
        items: [
          { text: 'Exact (One-Shot)', link: '/guide/exact' },
          { text: 'Prepaid (Agent Budgets)', link: '/guide/prepaid' },
          { text: 'Streaming (Micropayments)', link: '/guide/streaming' },
          { text: 'Escrow (Trustless Trade)', link: '/guide/escrow' },
          { text: 'SEAL (Pay-to-Decrypt)', link: '/guide/seal' },
        ],
      },
      {
        text: 'Packages',
        items: [
          { text: '@sweefi/sui', link: '/guide/sui' },
          { text: '@sweefi/server', link: '/guide/server' },
          { text: '@sweefi/mcp', link: '/guide/mcp' },
          { text: '@sweefi/ui-core', link: '/guide/ui-core' },
          { text: '@sweefi/react', link: '/guide/react' },
          { text: '@sweefi/vue', link: '/guide/vue' },
          { text: '@sweefi/cli', link: '/guide/cli' },
          { text: '@sweefi/solana', link: '/guide/solana' },
          { text: '@sweefi/ap2-adapter', link: '/guide/ap2-adapter' },
        ],
      },
      {
        text: 'Smart Contracts',
        items: [
          { text: 'Move Modules Overview', link: '/guide/contracts' },
          { text: 'Mandates (AP2)', link: '/guide/mandates' },
          { text: 'Fee & Trust Model', link: '/guide/fee-ownership' },
        ],
      },
    ],
    editLink: {
      pattern: 'https://github.com/sweeinc/sweefi/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/sweeinc/sweefi' },
    ],
    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: '© 2026 Swee Group LLC',
    },
    search: {
      provider: 'local',
    },
  },
})
