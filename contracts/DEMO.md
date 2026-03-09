# SweeFi Testnet Demo — Live on Sui

> All transactions below are **real**, **on-chain**, and **verifiable** on [Sui Testnet Explorer](https://suiscan.xyz/testnet).

**Package (testnet):** `0x04421dc12bdadbc1b7f7652cf2c299e7864571ded5ff4d7f2866de8304a820ef`
**Modules:** `payment`, `stream`, `escrow`, `seal_policy`, `mandate`, `agent_mandate`, `prepaid`, `admin`, `math`, `identity`
**Move tests:** 264 passing
**TypeScript tests:** 809 passing
**Total:** 1,073 tests across Move + TypeScript

---

## 1. Direct Payment — Agent Pays Merchant

An AI agent pays a merchant 10,000 MIST with 5% facilitator fee. Single PTB: split coin, pay, get receipt.

**Transaction:** [`Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK`](https://suiscan.xyz/testnet/tx/Gts9F3gXaVVqLfi4M9pSFkkc2WsC6zCJejZmrwi8f1iK)

| Field | Value |
|-------|-------|
| Payer | `0xb524...ea4f` |
| Merchant | `0x...0001` |
| Amount | 10,000 MIST |
| Fee (5%) | 500 MIST to `0x...0002` |
| Net to merchant | 9,500 MIST |
| PaymentReceipt | `0xffd2c8e26ebd0a69ad89802eb6a57ad92da2b5690befd529b2a96d99634db00f` |

**Event emitted:** `PaymentSettled` with receipt ID, payer, recipient, amount, fee, token type, and ms-precision timestamp.

**What this proves:** Atomic payment with fee split in a single transaction. The PaymentReceipt is an owned object with `key + store` — transferable to other protocols (SEAL access condition, escrow proof, etc.).

```bash
sui client ptb \
  --split-coins gas "[10000]" \
  --assign payment_coin \
  --move-call "$PKG::payment::pay<0x2::sui::SUI>" \
    payment_coin @MERCHANT 10000 500 @FEE_RECIPIENT 'vector[]' @0x6 \
  --assign receipt \
  --transfer-objects "[receipt]" @PAYER \
  --gas-budget 10000000
```

---

## 2. Streaming Micropayments — Per-Second Billing

A payer opens a streaming payment channel at 300 MIST/second (~$0.0003/sec with USDC decimals). The recipient claims accrued funds at any time. Budget cap prevents runaway spend.

**Live StreamingMeter:** [`0xbd8da3c7a69d1d10ee4dcada29c39272f1801349fce03fbb679d94ee231f08a3`](https://suiscan.xyz/testnet/object/0xbd8da3c7a69d1d10ee4dcada29c39272f1801349fce03fbb679d94ee231f08a3)

| Field | Value |
|-------|-------|
| Rate | 300 MIST/second |
| Budget Cap | 1,000,000 MIST |
| Deposit | 1,000,000 MIST |
| Status | Active (accruing) |

**Stream lifecycle:**
1. `create<T>()` — payer deposits funds, stream starts immediately
2. `claim<T>()` — recipient withdraws accrued tokens (fee split applied)
3. `pause<T>()` / `resume<T>()` — payer controls the meter (pre-pause accrual remains claimable)
4. `top_up<T>()` — payer adds more funds without creating a new stream
5. `close<T>()` — payer closes, final claim + refund
6. `recipient_close<T>()` — **NEW v3**: recipient force-closes after 7 days of inactivity (abandoned stream recovery)

**What this proves:** Real-time per-second billing on-chain. No pre-funding servers. The agent's budget is enforced by the contract, not by trust. Pause/resume gives the payer an emergency brake. Recipient close prevents fund lockup if the payer disappears.

```bash
# Create stream
sui client ptb \
  --split-coins gas "[100000]" \
  --assign deposit \
  --move-call "$PKG::stream::create<0x2::sui::SUI>" \
    deposit @PROVIDER 300 100000 50 @FEE_RECIPIENT @0x6 \
  --gas-budget 10000000

# Recipient claims (after time passes)
sui client call --package $PKG --module stream --function claim \
  --type-args 0x2::sui::SUI --args $METER_ID 0x6 --gas-budget 10000000
```

---

## 3. Escrow — Trustless Commerce with SEAL Integration

A buyer deposits 1,000,000 MIST into escrow. The seller delivers off-chain (or encrypts via SEAL). The buyer releases funds, or a deadline triggers automatic refund.

**Transaction:** [`EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR`](https://suiscan.xyz/testnet/tx/EcYFG3FTSwxM49UckuBhg2gYBPMzRBTNzmKy5Aq6UbzR)

**Live Escrow:** [`0xe1331575df1a93fe11ed1758ee7110c0a581f98d7ff889d40e23b6fa2a67b531`](https://suiscan.xyz/testnet/object/0xe1331575df1a93fe11ed1758ee7110c0a581f98d7ff889d40e23b6fa2a67b531)

| Field | Value |
|-------|-------|
| Buyer | `0xb524...ea4f` |
| Seller | `0x...0001` |
| Arbiter | `0x...0003` |
| Deposit | 1,000,000 MIST |
| Fee (2%) | 20,000 micro-pct (charged on release, not refund) |
| Deadline | ~1 hour from creation |
| Description | "SEAL demo" |
| State | ACTIVE (0) |

**Escrow state machine:**
```
ACTIVE ─── buyer release() ──────────→ RELEASED (receipt minted)
  │   └─── deadline passes, refund() → REFUNDED (no fee)
  │
  └── buyer/seller dispute() ──→ DISPUTED
                                  ├── arbiter release() → RELEASED
                                  └── arbiter refund()  → REFUNDED
                                  └── deadline passes   → REFUNDED (arbiter griefing protection)
```

**SEAL integration point:** The `escrow_id` is known at creation time. The seller encrypts the deliverable with a SEAL policy: "owns EscrowReceipt where escrow_id == 0xe133...b531". After the buyer releases, they receive the EscrowReceipt and can decrypt. **Pay-to-decrypt, on-chain.**

```bash
# Create escrow
sui client ptb \
  --split-coins gas "[50000]" \
  --assign deposit \
  --move-call "$PKG::escrow::create<0x2::sui::SUI>" \
    deposit @SELLER @ARBITER $DEADLINE_MS 200 @FEE_RECIPIENT \
    'vector[83, 69, 65, 76, 32, 100, 101, 109, 111]' @0x6 \
  --gas-budget 10000000

# Buyer releases (after delivery confirmed)
sui client call --package $PKG --module escrow --function release_and_keep \
  --type-args 0x2::sui::SUI --args $ESCROW_ID 0x6 --gas-budget 10000000
```

---

## Live Objects Summary

| Object | Type | ID |
|--------|------|----|
| StreamingMeter | `stream::StreamingMeter<SUI>` | `0xbd8da3c7...08a3` |
| Escrow | `escrow::Escrow<SUI>` | `0xe1331575...b531` |
| PaymentReceipt | `payment::PaymentReceipt` | `0xffd2c8e2...b00f` |

All three primitives are live on Sui Testnet. Verifiable. Open source. 264 Move tests passing.

---

## 4. MCP Tools — How AI Agents Actually Use This

SweeFi isn't just contracts — it's an **MCP server** that any AI agent can discover and call. The agent doesn't need to know Move, PTBs, or Sui internals. It calls tools.

**35 MCP tools across all modules:**

| Tool | What It Does |
|------|-------------|
| `sweefi_pay` | One-shot payment with fee split |
| `sweefi_pay_and_prove` | Pay and return receipt proof |
| `sweefi_create_invoice` | Create invoice for on-chain dedup |
| `sweefi_pay_invoice` | Pay and consume invoice |
| `sweefi_create_stream` | Open per-second billing channel (7-day default timeout) |
| `sweefi_create_stream_with_timeout` | Open billing channel with custom recipient_close timeout |
| `sweefi_claim_stream` | Recipient withdraws accrued tokens |
| `sweefi_pause_stream` | Emergency brake — payer stops accrual |
| `sweefi_resume_stream` | Restart after pause |
| `sweefi_close_stream` | Payer closes, final claim + refund |
| `sweefi_recipient_close_stream` | **Safety valve** — recover abandoned stream |
| `sweefi_create_escrow` | Deposit into time-locked vault |
| `sweefi_release_escrow` | Release funds to seller (+ SEAL receipt) |
| `sweefi_refund_escrow` | Refund to buyer (after deadline or arbiter) |
| `sweefi_dispute_escrow` | Raise dispute for arbiter resolution |
| `sweefi_check_payment` | Query payment/receipt status (read-only) |

### The "Safety Layer" in Action

Here's the scenario that no competitor handles: an AI agent is streaming payments for GPU inference. The payer agent crashes. Its keys are in a TEE that got recycled. The stream has 50,000 MIST locked in a shared object. Without SweeFi, those funds are **gone forever**.

With SweeFi, the recipient agent calls one MCP tool:

```
Tool: sweefi_recipient_close_stream
Input: { meter_id: "0x9edb...6ce2" }
```

After 7 days of inactivity, the contract automatically:
1. Calculates accrued funds up to the last activity
2. Transfers accrued amount to recipient (with fee split)
3. Refunds remainder to payer's address (recoverable if keys are restored)
4. Destroys the meter object (clean up)

**No human intervention. No admin keys. No support tickets.** The safety is in the contract, not in a company's SLA.

This is what "safety layer for autonomous agent commerce" means — every failure mode has an on-chain recovery path.

---

## Architecture: Why These Three Primitives

```
    ┌─────────────────────────────────────────────────────────┐
    │                    AI Agent (Claude, GPT, etc.)          │
    │            "I need to pay for this API call"             │
    └────────────────────────┬────────────────────────────────┘
                             │ discovers tools via MCP
    ┌────────────────────────▼────────────────────────────────┐
    │              SweeFi MCP Server (35 tools)               │
    │  sweefi_pay · sweefi_create_stream · sweefi_claim    │
    │  sweefi_pause · sweefi_recipient_close · ...           │
    └────────────────────────┬────────────────────────────────┘
                             │ builds PTBs via @sweefi/sui
    ┌────────────────────────▼────────────────────────────────┐
    │  s402 (HTTP 402)          @sweefi/sui + @sweefi/server   │
    │  (402 headers)            (TypeScript client + gateway)  │
    └────────────────────────┬────────────────────────────────┘
                             │ submits transactions
    ┌────────────────────────▼────────────────────────────────┐
    │            SweeFi Move Contracts (testnet)                    │
    │                                                          │
    │  ┌──────────┐   ┌──────────┐   ┌──────────────────┐    │
    │  │ payment  │   │  stream  │   │     escrow       │    │
    │  │          │   │          │   │                   │    │
    │  │ Instant  │   │ Per-sec  │   │ Conditional +    │    │
    │  │ + fee    │   │ + pause  │   │ SEAL encrypt     │    │
    │  │ + receipt│   │ + close  │   │ + arbiter        │    │
    │  └──────────┘   └──────────┘   └──────────────────┘    │
    │                                                          │
    └────────────────────────┬────────────────────────────────┘
                             │
    ┌────────────────────────▼────────────────────────────────┐
    │                      Sui L1                               │
    │     Objects · PTBs · Clock · SEAL · Walrus · zkLogin     │
    └──────────────────────────────────────────────────────────┘
```

**Payment** = instant settlement (s402 fast path)
**Stream** = continuous billing (GPU inference, API metering)
**Escrow** = conditional payment (marketplace, SEAL pay-to-decrypt)

Together they cover every payment pattern an AI agent needs. The MCP layer makes them discoverable. The s402 layer makes them interoperable. The Move contracts make them safe.
