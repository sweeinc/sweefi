# Reddit Post: s402 Announcement (r/sui)

**Posted**: February 28, 2026
**URL**: TBD (add link after posting)
**Subreddit**: r/sui

---

**Title:** `s402: Sui-native HTTP 402 payment protocol for AI agents (open source)`

**Body:**

Hello all! Wanted to share s402 — a Sui-native HTTP 402 protocol that lets AI agents pay for APIs automatically on-chain.

**The problem:** AI agents need to pay for APIs, compute, and data — but they can't swipe a credit card. Coinbase shipped x402 for EVM, which proved the concept, but it only supports pay-per-call and inherits EVM's security trade-offs: the facilitator holds signed transactions (trust bottleneck), and EIP-3009's authorize/transfer pattern has a temporal gap that opens a window for front-running.

**What s402 does differently:** On Sui, the entire payment settles in a single atomic PTB — no temporal gap, no intermediary holding your signed tx. The facilitator is optional, not a trust bottleneck. And instead of just pay-per-call, s402 supports 5 payment modes: exact, streaming micropayments, escrow, prepaid agent budgets, and mandates (spending limits for AI agents).

The prepaid mode is where the economics get interesting — an agent deposits once, makes thousands of API calls off-chain, and the provider batch-claims on-chain. ~$0.01 gas per 1K calls vs ~$1 per-call on Base. Wire-compatible with x402, so existing clients work with s402 servers out of the box.

**What's shipped:**

- 10 Move modules on Sui testnet (293 Move tests)
- Zero runtime dependencies (peer dep: @mysten/sui)
- Apache-2.0 license

`npm install s402`

GitHub: [s402-protocol/core](https://github.com/s402-protocol/core)

Feedback welcome!

---

## Context & Strategy Notes

- **Voice**: Matched Danny's sui-gas-station Reddit post style — warm, technical, not salesy
- **Key angles**: Security (atomic PTBs, no temporal gap) leads over gas costs (defensible architectural argument vs volatile numbers)
- **SweeFi not mentioned**: Intentional — positioning as open protocol author, not product marketer
- **Previous post for reference**: [sui-gas-station on r/sui](https://www.reddit.com/r/sui/comments/1r5q1ik/suigasstation_selfhosted_gas_sponsorship_library/)
