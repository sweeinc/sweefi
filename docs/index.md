---
layout: home
hero:
  name: SweeFi
  text: Give your AI agents a budget, not a blank check.
  tagline: >-
    Five payment schemes on Sui with on-chain spending controls.
    42 PTB builders. AP2 mandates. L0-L3 authorization levels.
    From one-shot payments to prepaid agent budgets — all open source.
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/quickstart-agent
    - theme: alt
      text: View on GitHub
      link: https://github.com/sweeinc/sweefi
    - theme: alt
      text: Why SweeFi?
      link: /guide/
features:
  - icon: ⚡
    title: Five payment schemes
    details: Exact, Prepaid, Streaming, Escrow, and SEAL (pay-to-decrypt). One protocol, every payment pattern an AI agent needs.
  - icon: 🤖
    title: Built for AI agents
    details: 35 MCP tools for Claude and Cursor. Agents discover pricing via HTTP 402, pay autonomously, and self-recover from errors.
  - icon: 🔒
    title: Atomic PTB settlement
    details: No temporal gap between verify and settle. Sui's Programmable Transaction Blocks make payment + receipt creation a single atomic operation.
  - icon: 💰
    title: ~70x gas savings
    details: Prepaid deposits let agents make thousands of API calls off-chain. One deposit transaction replaces hundreds of individual payments (~70x gas savings).
  - icon: 🔌
    title: x402-compatible
    details: Wire-compatible with Coinbase's x402. Existing x402 clients talk to SweeFi servers with zero code changes.
  - icon: 🛡️
    title: No admin fund access
    details: AdminCap can pause new deposits but never extract funds. Exits are always open. Permissionless recovery on every primitive.
---

## See It in Action

An AI agent hits a paid API. The server says "pay me." The agent pays within its mandate budget, gets the data, and produces an on-chain receipt. Three HTTP round-trips, zero human intervention.

```typescript
import { createS402Client } from '@sweefi/sui';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const wallet = Ed25519Keypair.fromSecretKey(myKey);
const client = createS402Client({ wallet, network: 'sui:testnet' });

// Any fetch to a 402-gated endpoint auto-pays
const data = await client.fetch('https://api.example.com/premium-data');
// 402 → auto-sign SUI payment → retry with proof → receive data
```

SweeFi handles the s402 negotiation, PTB construction, signing, and settlement. You bring a Sui keypair and a mandate. The agent operates within your spending bounds.

---

**v0.1.0** · 10 packages · 800+ tests · 10 Move modules · Apache 2.0 · Built on [s402](https://www.npmjs.com/package/s402) and [Sui](https://sui.io)
