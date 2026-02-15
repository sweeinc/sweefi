# SweePay Testnet Demo — Live on Sui

> All transactions below are **real**, **on-chain**, and **verifiable** on [Sui Testnet Explorer](https://suiscan.xyz/testnet).

**Package (v7):** `0xc80485e9182c607c41e16c2606abefa7ce9b7f78d809054e99486a20d62167d5`
**Modules:** `payment`, `stream`, `escrow`, `seal_policy`, `mandate`, `agent_mandate`, `prepaid`, `admin`
**Move tests:** 226 annotations passing (158 positive + 68 negative-path)
**TypeScript tests:** 417 passing (25+ PTB builders, composable pay-and-prove)
**Total:** 640+ tests across Move + TypeScript

---

## 1. Direct Payment — Agent Pays Merchant

An AI agent pays a merchant 10,000 MIST with 5% facilitator fee. Single PTB: split coin, pay, get receipt.

**Transaction:** [`7YbMKa4LjsFwxBQtGz92LnJ5XmhzNEvWXahxcnBct9ne`](https://suiscan.xyz/testnet/tx/7YbMKa4LjsFwxBQtGz92LnJ5XmhzNEvWXahxcnBct9ne)

| Field | Value |
|-------|-------|
| Payer | `0xb524...ea4f` |
| Merchant | `0x...BEEF` |
| Amount | 10,000 MIST |
| Fee (5%) | 500 MIST to `0x...FEE` |
| Net to merchant | 9,500 MIST |
| PaymentReceipt | `0xaabfaec0ab04d2c7d403dc23a26e1089d3bb9f4291636107abdbb51bf9728e7e` |

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

**Live StreamingMeter:** [`0x9edbb545e68c7a99d6eb81acedcb1d88c2f05d6177ae86b693d74daa587b6ce2`](https://suiscan.xyz/testnet/object/0x9edbb545e68c7a99d6eb81acedcb1d88c2f05d6177ae86b693d74daa587b6ce2)

| Field | Value |
|-------|-------|
| Rate | 300 MIST/second |
| Budget Cap | 100,000 MIST |
| Deposit | 100,000 MIST |
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

A buyer deposits 50,000 MIST into escrow. The seller delivers off-chain (or encrypts via SEAL). The buyer releases funds, or a deadline triggers automatic refund.

**Transaction:** [`bnB9Lu913jtxZmnz9McFXDwMBVJx5yRTgL9LEhLHgei`](https://suiscan.xyz/testnet/tx/bnB9Lu913jtxZmnz9McFXDwMBVJx5yRTgL9LEhLHgei)

**Live Escrow:** [`0x7e4447a8574182f880f0bf76d1db9da7d8a14ee867e414525a205a3a34de41ff`](https://suiscan.xyz/testnet/object/0x7e4447a8574182f880f0bf76d1db9da7d8a14ee867e414525a205a3a34de41ff)

| Field | Value |
|-------|-------|
| Buyer | `0xb524...ea4f` |
| Seller | `0x...BEEF` |
| Arbiter | `0x...DAD` |
| Deposit | 50,000 MIST |
| Fee (2%) | 200 bps (charged on release, not refund) |
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

**SEAL integration point:** The `escrow_id` is known at creation time. The seller encrypts the deliverable with a SEAL policy: "owns EscrowReceipt where escrow_id == 0x7e44...41ff". After the buyer releases, they receive the EscrowReceipt and can decrypt. **Pay-to-decrypt, on-chain.**

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
| StreamingMeter | `stream::StreamingMeter<SUI>` | `0x9edbb545...b6ce2` |
| Escrow | `escrow::Escrow<SUI>` | `0x7e4447a8...e41ff` |
| PaymentReceipt | `payment::PaymentReceipt` | `0xaabfaec0...8e7e` |

All three primitives are live on Sui Testnet. Verifiable. Open source. 226 Move test annotations.

---

## 4. MCP Tools — How AI Agents Actually Use This

SweePay isn't just contracts — it's an **MCP server** that any AI agent can discover and call. The agent doesn't need to know Move, PTBs, or Sui internals. It calls tools.

**16 MCP tools across all 3 modules:**

| Tool | What It Does |
|------|-------------|
| `sweepay_pay` | One-shot payment with fee split |
| `sweepay_pay_and_prove` | Pay and return receipt proof |
| `sweepay_create_invoice` | Create invoice for on-chain dedup |
| `sweepay_pay_invoice` | Pay and consume invoice |
| `sweepay_create_stream` | Open per-second billing channel (7-day default timeout) |
| `sweepay_create_stream_with_timeout` | Open billing channel with custom recipient_close timeout |
| `sweepay_claim_stream` | Recipient withdraws accrued tokens |
| `sweepay_pause_stream` | Emergency brake — payer stops accrual |
| `sweepay_resume_stream` | Restart after pause |
| `sweepay_close_stream` | Payer closes, final claim + refund |
| `sweepay_recipient_close_stream` | **Safety valve** — recover abandoned stream |
| `sweepay_create_escrow` | Deposit into time-locked vault |
| `sweepay_release_escrow` | Release funds to seller (+ SEAL receipt) |
| `sweepay_refund_escrow` | Refund to buyer (after deadline or arbiter) |
| `sweepay_dispute_escrow` | Raise dispute for arbiter resolution |
| `sweepay_check_payment` | Query payment/receipt status (read-only) |

### The "Safety Layer" in Action

Here's the scenario that no competitor handles: an AI agent is streaming payments for GPU inference. The payer agent crashes. Its keys are in a TEE that got recycled. The stream has 50,000 MIST locked in a shared object. Without SweePay, those funds are **gone forever**.

With SweePay, the recipient agent calls one MCP tool:

```
Tool: sweepay_recipient_close_stream
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
    │              SweePay MCP Server (16 tools)               │
    │  sweepay_pay · sweepay_create_stream · sweepay_claim    │
    │  sweepay_pause · sweepay_recipient_close · ...           │
    └────────────────────────┬────────────────────────────────┘
                             │ builds PTBs via @sweepay/sui
    ┌────────────────────────▼────────────────────────────────┐
    │  s402 (HTTP 402)          @sweepay/sdk                   │
    │  (402 headers)            (TypeScript client)            │
    └────────────────────────┬────────────────────────────────┘
                             │ submits transactions
    ┌────────────────────────▼────────────────────────────────┐
    │            SweePay Move Contracts (v7)                    │
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
