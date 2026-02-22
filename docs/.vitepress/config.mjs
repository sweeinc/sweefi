import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "SweeFi",
  description: "Sui-native HTTP 402 payments for the agentic economy.",
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Documentation', link: '/guide/' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is SweeFi?', link: '/guide/' },
          { text: 'Architecture & Brand', link: '/guide/architecture' }
        ]
      },
      {
        text: 'Packages',
        items: [
          { text: '@sweefi/sui — Sui Adapter', link: '/guide/sui' },
          { text: '@sweefi/server — HTTP Gateway', link: '/guide/server' },
          { text: '@sweefi/ui-core — State Machine', link: '/guide/ui-core' },
          { text: '@sweefi/vue — Vue Plugin', link: '/guide/vue' },
          { text: '@sweefi/react — React Hook', link: '/guide/react' },
          { text: '@sweefi/mcp — AI Agent Tools', link: '/guide/mcp' },
          { text: '@sweefi/cli — CLI Tool', link: '/guide/cli' },
        ]
      },
      {
        text: 'Payment Schemes',
        items: [
          { text: 'Exact (One-shot)', link: '/guide/exact' },
          { text: 'Prepaid (Agent Budgets)', link: '/guide/prepaid' },
          { text: 'Streaming (Micropayments)', link: '/guide/streaming' },
          { text: 'Escrow (Trustless Trade)', link: '/guide/escrow' },
          { text: 'SEAL (Pay-to-Decrypt)', link: '/guide/seal' },
        ]
      },
      {
        text: 'Smart Contracts',
        items: [
          { text: 'Move Modules Overview', link: '/guide/contracts' },
          { text: 'AP2 Mandates', link: '/guide/mandates' },
          { text: 'Fee & Trust Model', link: '/guide/fee-ownership' },
        ]
      },
      {
        text: 'Guides',
        items: [
          { text: 'Quick Start (Agent)', link: '/guide/quickstart-agent' },
          { text: 'Quick Start (Server)', link: '/guide/quickstart-server' },
          { text: 'Self-Hosting Facilitator', link: '/guide/facilitator' },
          { text: 'MCP Claude Desktop Setup', link: '/guide/mcp-setup' },
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/sweeinc/sweefi' }
    ]
  }
})
