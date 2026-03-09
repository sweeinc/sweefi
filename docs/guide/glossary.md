# Glossary

Domain-specific terms used across SweeFi's codebase and documentation.

---

## Protocol Terms

**s402**
: Sui-native HTTP 402 payment protocol. Wire-compatible with x402 but architecturally superior: atomic settlement via PTBs (no temporal gap), five payment schemes instead of one. See [Architecture](/guide/architecture).

**x402**
: Coinbase's HTTP 402 payment protocol for EVM chains. s402 servers always include `"exact"` in their `accepts` array, so x402 clients work without modification. x402 supports exact payments only and uses a verify-first-settle-later model.

**HTTP 402 (Payment Required)**
: HTTP status code meaning "payment is required." The s402 protocol uses the 402 response to carry payment requirements (amount, scheme, accepted networks) in a `payment-required` header. The client auto-pays and retries with an `x-payment` header.

**CAIP-2**
: Chain-Agnostic Improvement Proposal 2 — standard format for identifying blockchain networks. SweeFi uses CAIP-2 strings (`sui:testnet`, `sui:mainnet`) as the canonical network identifier.

**PTB (Programmable Transaction Block)**
: Sui's composable transaction model. A PTB bundles multiple Move calls into a single atomic transaction — if any step fails, everything reverts. SweeFi exposes ~42 PTB builders that return a `Transaction` object ready to sign. See [ADR-001](/adr/001-composable-ptb-pattern).

**MIST**
: The base unit of SUI. 1 SUI = 1,000,000,000 (10^9) MIST. All on-chain amounts in SweeFi contracts are denominated in MIST. Example: `MIN_DEPOSIT = 1,000,000 MIST` (~0.001 SUI).

**Payment Scheme**
: A named mode of payment supported by s402. SweeFi implements five: [Exact](/guide/exact) (one-shot), [Prepaid](/guide/prepaid) (deposit-based batching), [Escrow](/guide/escrow) (time-locked trade), [Stream](/guide/streaming) (per-second micropayments), and [Seal](/guide/seal) (pay-to-decrypt).

---

## SweeFi-Specific Terms

**Facilitator**
: A service that sits between an API server and the Sui blockchain. It verifies that a signed transaction matches the server's requirements, then broadcasts it to Sui and returns a settlement proof. Non-custodial: cannot extract funds, forge receipts, or redirect payments. See [Self-Hosting Facilitator](/guide/facilitator).

**PaymentReceipt**
: On-chain owned object created by `payment::pay()` on successful payment. Records payer, recipient, amount, fee, token type, timestamp, and optional memo. Has `key + store` — transferable and usable as a SEAL decryption condition. See [ADR-005](/adr/005-permissive-access-receipt-transferability).

**EscrowReceipt**
: On-chain owned object created when an escrow is released. Records escrow ID, buyer, seller, amount, fee, token type, and release time. Like `PaymentReceipt`, it has `key + store` and serves as a bearer SEAL decryption credential.

**Bearer Receipt**
: A receipt whose access rights follow ownership, not the original buyer's identity. Transferring a `PaymentReceipt` or `EscrowReceipt` transfers the access right. Implemented per [ADR-005](/adr/005-permissive-access-receipt-transferability) — `seal_approve` must NEVER check `ctx.sender()`.

**StreamingMeter**
: Shared on-chain object representing an active payment stream. Stores payer, recipient, balance, rate-per-second, budget cap, accrual state, and pause state. Must be shared because both payer and recipient mutate it (consensus path, ~2–3s).

**PrepaidBalance**
: Shared on-chain object representing an agent's deposited budget. Stores agent address, provider address, deposited balance, rate-per-call, cumulative claimed calls, and withdrawal delay. See [Prepaid scheme](/guide/prepaid).

**Mandate**
: On-chain authorization object created by a human delegator allowing an AI agent to spend funds on their behalf, subject to per-transaction and lifetime caps plus an expiry. Revocation uses a `RevocationRegistry`. See [Mandates](/guide/mandates).

**AgentMandate**
: Extended mandate with L0–L3 progressive autonomy levels and daily/weekly spending caps. Counters reset lazily at the next spend call rather than on a timer. See [Mandates](/guide/mandates).

**RevocationRegistry**
: Shared on-chain object owned by a mandate delegator. Stores a dynamic-field set of revoked mandate IDs. A pre-publication security fix ensures callers assert `registry.owner == mandate.delegator` before checking revocation.

**s402Gate**
: Server-side HTTP middleware from `@sweefi/server`. When applied to a route, it returns a 402 with payment requirements if no valid `x-payment` header is present, and verifies payment against the facilitator before allowing the request through.

**PaymentAdapter**
: Interface defined in `@sweefi/ui-core` that abstracts chain-specific signing and broadcasting. `SuiPaymentAdapter` implements it for Sui; UI packages (`@sweefi/vue`, `@sweefi/react`) work against this interface without chain-specific imports.

---

## Sui Terms

**Move**
: Programming language for Sui smart contracts. Has a linear type system and `key`/`store`/`copy`/`drop` abilities that govern what can happen to a value. Unsigned integer arithmetic aborts on overflow/underflow (no wrapping).

**Owned Object**
: A Sui object belonging to exactly one address. Transactions using only owned objects skip consensus (fast path, ~200ms). `PaymentReceipt`, `EscrowReceipt`, `Mandate`, and `AgentMandate` are owned objects. See [ADR-006](/adr/006-object-ownership-model).

**Shared Object**
: A Sui object accessible by multiple addresses, requiring consensus to mutate (~2–3s). `StreamingMeter`, `Escrow`, `PrepaidBalance`, `ProtocolState`, and `RevocationRegistry` are shared. An object is shared only when multiple distinct addresses must mutate it. See [ADR-006](/adr/006-object-ownership-model).

**Coin**
: On-chain representation of a fungible token (`Coin<T>` in Move). SweeFi contracts accept any coin type — `0x2::sui::SUI` for native SUI, or USDC coin types for stablecoins. Coin types differ by network.

**Gas**
: On-chain execution fee paid to Sui validators in MIST. SweeFi's prepaid scheme reduces gas cost from ~$1 per 1,000 calls (per-call exact on EVM L2s) to ~$0.014 per 1,000 calls via batching. See [ADR-002](/adr/002-batch-claims-gas-economics).

**zkLogin**
: Sui authentication allowing users to sign transactions via OAuth (Google, Facebook, etc.) instead of raw keypairs. Currently unsupported in SweeFi's facilitator signature verification.

**did:sui**
: Decentralized Identifier using Sui as the DID method. SweeFi's `identity.move` creates agent identity profiles under the `did:sui` scheme.

---

## Fee & Math Terms

**Micro-Percent**
: SweeFi's on-chain fee unit. Denominator is 1,000,000 (= 100%), enabling sub-basis-point precision. Example: 5,000 micro-percent = 0.5%. Conversion: `bps × 100 = micro-percent`. See [ADR-003](/adr/003-fee-rounding-financial-precision).

**Basis Points (bps)**
: Traditional financial unit where 10,000 bps = 100%. Used in the s402 wire format (`protocolFeeBps`). Converted to micro-percent via `bpsToMicroPercent()` in `packages/sui/src/ptb/assert.ts` before on-chain use.

**u128 Intermediate**
: Mandatory arithmetic technique in SweeFi's Move contracts: all fee calculations cast to `u128` before multiplying, then back to `u64` after dividing. Prevents integer overflow at amounts > ~1.8 × 10^15 tokens. See [ADR-003](/adr/003-fee-rounding-financial-precision).

**Truncation (Floor Rounding)**
: Rounding direction for all fee calculations. Move's unsigned division naturally truncates toward zero: `fee = floor(amount × fee_micro_pct / 1,000,000)`. The invariant `fee + net <= gross` always holds. See [ADR-003](/adr/003-fee-rounding-financial-precision).

**Budget Cap**
: Hard upper limit on total payout from a streaming payment, set at creation. When `total_claimed >= budget_cap`, the stream aborts with `ENothingToClaim`.

---

## Architecture & Security Terms

**AdminCap**
: Owned on-chain capability object created once in `admin.move`. Holder can pause/unpause the protocol but has NO fund-extraction rights. Can be irrevocably burned (`transfer to 0x0`) to make the protocol fully trustless. See [ADR-004](/adr/004-admin-cap-emergency-pause).

**ProtocolState**
: Shared on-chain object with a `paused: bool` field. Every new-deposit operation checks this flag. Exit operations are never blocked. Part of the two-tier pause model.

**Two-Tier Pause**
: Emergency pause design from [ADR-004](/adr/004-admin-cap-emergency-pause). The `paused` flag only blocks operations that bring new money in (create, deposit, top_up). Exit operations (claim, close, refund, withdraw, release) are never blocked — users can always recover funds.

**Permissionless Exit**
: Safety guarantee: after a timeout or deadline, **anyone** can call `recipient_close()` or `refund()`. Funds cannot be permanently locked by payer inaction.

**Arbiter**
: Neutral third party specified at escrow creation who resolves disputes. When `dispute()` is called, only the arbiter can call `release()` or `refund()`. After the dispute deadline, permissionless refund takes over.

**SEAL (Sui Encryption Abstraction Layer)**
: Sui's threshold encryption system. Content is encrypted with a key held across distributed key servers. Key servers release the decryption key only if the caller satisfies an on-chain condition — in SweeFi, owning a valid receipt. See [Seal scheme](/guide/seal).

**Idempotent Dedup**
: Facilitator middleware that caches successful settlement responses. On retry after network timeout, returns the cached response with `X-Idempotent-Replay: true` instead of a 500 error. Dedup key includes API key to prevent cross-tenant collisions. See [ADR-008](/adr/008-facilitator-api-gaps).

**MCP (Model Context Protocol)**
: Anthropic's standard for exposing tools to AI agents. `@sweefi/mcp` is a MCP server with 35 tools (prefixed `sweefi_`) for payments, streaming, escrow, prepaid, and mandates. See [@sweefi/mcp](/guide/mcp).

**AP2 (Agent Payments Protocol)**
: Google's off-chain authorization protocol for AI agent spending. SweeFi's mandate system is a strict superset: adds periodic caps, L0–L3 tiered autonomy, and instant on-chain revocation. `@sweefi/ap2-adapter` bridges AP2 mandates to SweeFi. See [ADR-009](/adr/009-ap2-agent-mandate-integration).

**TEE (Trusted Execution Environment)**
: Hardware-enforced secure computation (e.g., Intel SGX, Nautilus on Sui). Planned for prepaid scheme v0.4 — hardware-attested API call counts would make provider claims cryptographically verifiable. See [ADR-007](/adr/007-prepaid-trust-model).
