# SweeFi Integrator Quickstart

Goal: first successful paid request in under 15 minutes.

## Prerequisites

- Node 20+
- pnpm 9+
- A funded Sui testnet keypair
- A terminal with two shells

## 1) Install and Build

```bash
cd /Users/dannydevs/repos/danny/projects/sweefi-project
pnpm install
pnpm -r build
```

## 2) Start a Paid Endpoint (Shell A)

Create `tmp/paid-server.ts`:

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentGate } from "@sweefi/sdk/server";

const app = new Hono();

app.use(
  "/premium",
  paymentGate({
    price: "$0.01",
    network: "sui:testnet",
    payTo: "0xYOUR_TESTNET_ADDRESS",
  }),
);

app.get("/premium", (c) =>
  c.json({ ok: true, data: "paid response from sweefi demo" }),
);

serve({ fetch: app.fetch, port: 4020 });
console.log("Paid API listening on http://localhost:4020");
```

Run:

```bash
pnpm dlx tsx tmp/paid-server.ts
```

## 3) Call It with Auto-Payment (Shell B)

Create `tmp/paid-client.ts`:

```ts
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createPayingClient } from "@sweefi/sdk/client";

const keypair = Ed25519Keypair.fromSecretKey(process.env.SUI_SECRET_KEY_BASE64!);

const client = createPayingClient({
  wallet: keypair,
  network: "sui:testnet",
});

const res = await client.fetch("http://localhost:4020/premium");
console.log("status:", res.status);
console.log("body:", await res.text());
```

Run:

```bash
SUI_SECRET_KEY_BASE64="<your-base64-secret>" pnpm dlx tsx tmp/paid-client.ts
```

Expected result:
- HTTP `200`
- JSON body with `"paid response from sweefi demo"`

## 4) Verify and Share Evidence

- Keep tx digest from client logs.
- Add transaction/object links to `docs/PROOF-OF-WORK.md`.
- Share this packet with partners:
  - `README.md`
  - `docs/PROOF-OF-WORK.md`
  - `docs/BUSINESS-STRATEGY.md`

## Troubleshooting

- If you see DNS/RPC errors, re-run with stable network and retry.
- If payment fails, confirm testnet wallet has enough SUI for gas/payment.
- If server returns `402` repeatedly, verify client network and key are both testnet.

