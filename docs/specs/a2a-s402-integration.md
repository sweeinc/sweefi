# A2A + s402 Integration Guide

**Status:** Draft
**Date:** 2026-02-28

## Overview

This document describes how A2A (Agent-to-Agent) agents discover and use s402-gated services for on-chain payments on Sui.

A2A handles agent discovery and communication. s402 handles settlement. They are complementary protocols at different layers:

```
A2A (Discovery + Communication)
 ↓ Agent finds service, negotiates capabilities
AP2 (Authorization — optional)
 ↓ Human pre-authorizes agent spending via mandate
s402 (Wire Protocol)
 ↓ HTTP 402 challenge-response
SweeFi (Settlement)
 ↓ Mandate<T> enforcement + PTB execution
Sui (Consensus)
```

## Agent Discovery

An A2A agent discovers s402-gated services through standard A2A service discovery. The service's Agent Card declares payment capabilities:

```json
{
  "name": "Premium Data API",
  "description": "Real-time market data with s402 payment",
  "capabilities": {
    "payment": {
      "methods": ["s402"],
      "schemes": ["exact", "prepaid"],
      "networks": ["sui:mainnet"],
      "assets": ["0x2::sui::SUI"]
    }
  }
}
```

## Payment Flow: A2A Agent → s402 Service

### Step 1: Agent Requests Resource

The A2A agent makes a standard HTTP request to the service endpoint.

```http
GET /api/market-data HTTP/1.1
Host: api.example.com
```

### Step 2: Service Returns 402

The service responds with HTTP 402 and s402 payment requirements.

**Header transport:**
```http
HTTP/1.1 402 Payment Required
payment-required: <base64 s402PaymentRequirements JSON>
```

**Body transport:**
```http
HTTP/1.1 402 Payment Required
Content-Type: application/s402+json

{
  "s402Version": "1",
  "accepts": ["exact", "prepaid"],
  "network": "sui:mainnet",
  "asset": "0x2::sui::SUI",
  "amount": "1000000",
  "payTo": "0x<service-address>",
  "facilitatorUrl": "https://facilitator.example.com"
}
```

### Step 3: Agent Checks Mandate (if AP2-authorized)

If the agent operates under an AP2 mandate, it verifies the payment is within its authorized limits:

```typescript
// Agent checks: is this payment within my mandate?
const mandate = await getMandateState(mandateId);
if (BigInt(requirements.amount) > BigInt(mandate.maxPerTx)) {
  throw new Error('Payment exceeds per-transaction mandate limit');
}
if (mandate.isRevoked) {
  throw new Error('Mandate has been revoked');
}
```

### Step 4: Agent Constructs and Signs PTB

```typescript
import { s402Client } from 's402';

const payment = await client.createPayment(requirements, {
  signer: agentKeypair,
  coinType: '0x2::sui::SUI',
});
```

### Step 5: Agent Resends Request with Payment

**Header transport:**
```http
GET /api/market-data HTTP/1.1
Host: api.example.com
x-payment: <base64 s402PaymentPayload JSON>
```

**Body transport:**
```http
POST /api/market-data HTTP/1.1
Host: api.example.com
Content-Type: application/s402+json

{
  "s402Version": "1",
  "scheme": "exact",
  "payload": {
    "transaction": "<base64 PTB>",
    "signature": "<base64 Ed25519 signature>"
  }
}
```

### Step 6: Settlement + Response

The service verifies the payment via its facilitator, settles on Sui (atomic PTB execution), and returns the resource with a settlement receipt.

```http
HTTP/1.1 200 OK
payment-response: <base64 s402SettleResponse JSON>
Content-Type: application/json

{ "data": { ... } }
```

## Scheme Selection Guide

| Use Case | Recommended Scheme | Why |
|---|---|---|
| Single API call | `exact` | Simple, one-time payment |
| High-frequency API (100+ calls/session) | `prepaid` | Deposit once, draw per-call. Sub-cent viable. |
| Real-time data stream | `stream` | Pay-per-second with rate cap and budget ceiling |
| Service delivery with dispute risk | `escrow` | Payment held until confirmed. Arbiter for disputes. |
| Encrypted content access | `unlock` | Payment triggers SEAL decryption key release |

## AP2 Mandate Integration

For agents operating under AP2 authorization, the `@sweefi/ap2-adapter` package bridges AP2 mandates to SweeFi on-chain mandates:

```typescript
import { createInvoiceFromAP2Cart, createAgentMandateFromAP2Intent } from '@sweefi/ap2-adapter';

// Strong mapping: CartMandate → Invoice (amount, payer, payee all map)
const invoice = createInvoiceFromAP2Cart(cartMandate, {
  coinType: '0x2::sui::SUI',
  payer: payerAddress,              // Invoice sent to payer
  payee: merchantAddress,           // Merchant receives payment
  usdToBaseUnits: 1_000_000n,       // 1 USD = 1M base units (USDC-6)
  feeMicroPercent: 5_000,            // 0.5% facilitator fee (5,000 / 1,000,000)
  feeRecipient: facilitatorAddress, // Fee recipient
});

// Factory mapping: IntentMandate → AgentMandate (TTL from AP2, rest caller-provided)
const mandateParams = createAgentMandateFromAP2Intent(intentMandate, {
  coinType: '0x2::sui::SUI',
  delegator: humanAddress,
  delegate: agentAddress,
  maxPerTx: '5000000000',     // 5 SUI per transaction
  dailyLimit: '50000000000',  // 50 SUI daily
  weeklyLimit: '200000000000', // 200 SUI weekly
  maxTotal: '1000000000000',  // 1000 SUI lifetime
  level: 2, // CAPPED
});
```

## Multi-Agent Scenarios

### Agent-to-Agent Payments

A2A agents can pay each other for services using s402:

```
Agent A (consumer) ──s402──► Agent B (provider)
     │                            │
     └── PTB signed by A ────────►│
                                  └── Settles on Sui
```

### Orchestrator Pattern

An orchestrator agent manages multiple sub-agents, each with their own mandate:

```
Human
 └── AP2 IntentMandate ("spend up to $50 on research")
      └── Orchestrator Agent (Mandate: 50 SUI daily)
           ├── Sub-agent A (Mandate: 10 SUI daily) ──s402──► Data API
           ├── Sub-agent B (Mandate: 10 SUI daily) ──s402──► Compute API
           └── Sub-agent C (Mandate: 10 SUI daily) ──s402──► Storage API
```

Each sub-agent has an independent on-chain mandate with its own caps, revocable independently.

## Service Discovery via .well-known

s402 services can advertise their capabilities at a well-known endpoint:

```
GET /.well-known/s402.json
```

```json
{
  "s402Version": "1",
  "schemes": ["exact", "prepaid", "stream"],
  "networks": ["sui:mainnet"],
  "assets": ["0x2::sui::SUI"],
  "facilitatorUrl": "https://facilitator.example.com",
  "directSettlement": false,
  "mandateSupport": true,
  "protocolFeeBps": 50
}
```

A2A agents can check this endpoint during service discovery to determine payment capabilities before initiating a session.

## References

- [s402 Payment Method Specification](./scheme_s402_sui.md)
- [A2A Protocol](https://google.github.io/A2A/)
- [AP2 Protocol](https://ap2-protocol.org/specification/)
- [SweeFi AP2 Adapter](../../packages/ap2-adapter/)
