# ADR-008: Facilitator API Surface Gaps — 2026-02-21

**Status:** Accepted
**Author:** Danny Saenz
**Context:** Teaching session — multi-language facilitator deep dive

---

## Context

An expert panel (REST API, Security, Payment Systems, DevOps, Blockchain) reviewed the
facilitator's 6-endpoint API surface. Findings were validated against the codebase by two
exploration agents, then reviewed by a skeptic agent before implementation.

---

## Decisions

### 1. Added `GET /ready` (readiness probe)

**Problem:** `/health` is a liveness probe — it confirms the process is alive but not that
it can settle payments. Kubernetes and Fly.io distinguish liveness from readiness. A
facilitator with misconfigured schemes or an unreachable Sui RPC would pass `/health`
while failing every settlement.

**Decision:** Add `/ready` checking (1) scheme registration via `supportedSchemes()` and
(2) Sui RPC connectivity via `sui_getLatestCheckpointSequenceNumber` with a 3s
`AbortSignal.timeout`. Falls back to Mysten default RPC URLs if custom ones aren't set.
Returns 503 when any check fails.

**Rejected:** Scheme registration check alone — the skeptic correctly flagged that checking
configuration ≠ checking actual service health. "Config check" is not a readiness probe.

---

### 2. Added `GET /settlements` (per-key settlement history)

**Problem:** `UsageTracker` stores settlement records in memory but no HTTP route exposed
them. Operators and integrators have no way to query their settlement history via API.

**Decision:** Expose records for the *calling API key only*, with pagination
(`?limit`, `?offset`) and a `dataRetainedSince` field showing the server start time.

**Rejected — fleet-wide `/stats` endpoint:** A skeptic review found that any API key
holder seeing aggregate data across all keys is a cross-tenant information leak: key count
delta reveals new customer onboarding, network distribution reveals competitive intelligence.
Rather than add admin-only auth complexity, per-key summary via `/settlements` serves
legitimate operator needs without the leak.

**Note on `dataRetainedSince`:** `UsageTracker` is in-memory. Records are lost on restart.
Without `dataRetainedSince`, a client using this for reconciliation would not know they have
gaps. Self-describing data beats out-of-band documentation.

---

### 3. Added `src/middleware/dedup.ts` (payload dedup)

**Problem:** Network-timeout scenario: client POSTs to `/s402/process`, facilitator
broadcasts to Sui successfully, HTTP response is lost before reaching the client. Client
retries with the same signed payload. Sui rejects the duplicate tx ("already exists") → the
facilitator returns 500. Client cannot distinguish "payment failed" from "payment succeeded
but I didn't hear back."

**Decision:** In-memory dedup middleware with:
- Key: `SHA-256(apiKey + ":" + canonicalJSON(body))` — API key included to prevent
  cross-tenant cache collisions (two customers with identical payloads must not share a cache entry)
- TTL: 60s (Sui finalizes in ~500ms; 60s covers aggressive retry windows)
- Only 2xx responses cached — 4xx and 5xx remain retryable
- Applied after `apiKeyAuth` (needs key in context), before `rateLimiter` (cache hits
  should not consume tokens)

**Rejected — 5-minute TTL:** Skeptic flagged this as 600x longer than Sui's finality time.
Reduced to 60s.

**Rejected — body-only dedup key (without apiKey):** A critical bug — two customers with
identical payment payloads would share a cache entry, returning one customer's settlement
receipt to another. Always scope caches to the auth principal.

**Safety note:** Sui itself rejects duplicate signed transactions at the protocol level.
This middleware is a *reliability* improvement (returns cached 200 instead of 500), not a
*safety* requirement. No double-payment is possible even without it.

**Phase 1 limitation:** In-memory store is lost on restart. After a restart, a retried
payload re-processes — safe (Sui rejects it), but the client gets a fresh 500. Phase 2:
Redis-backed store for cross-instance and cross-restart persistence.

**Confirmed non-issue — Hono body stream:** A skeptic raised concern that reading the body
in middleware would consume the stream before the route handler. Verified in Hono source
(`node_modules/hono/dist/request.js`, `#cachedBody` method): Hono caches all
`c.req.*()` body reads internally. Route handlers can call `c.req.json()` after middleware
has already done so. Using `c.req.raw.*()` directly would consume the stream — using the
Hono API is safe.

---

## Rejected Proposals

| Proposal | Reason |
|---|---|
| Prometheus `/metrics` endpoint | `IMetrics` + `NoopMetrics` seam already exists. Swap in implementation. Phase 2. |
| Facilitator identity signature on `/.well-known/s402-facilitator` | `FACILITATOR_KEYPAIR` config already scoped. Separate PR for Ed25519 signing. |
| Webhook callbacks for async settlement | Significant scope: callback URL management, retry logic, persistence. Phase 2. |
| `GET /tx/{digest}` RPC proxy | Scope creep. Clients query Sui RPC directly. Facilitator is a payment processor. |
| API versioning (`/v1/` prefix) | Breaking protocol change. `s402Version` in responses is sufficient. Needs broader discussion. |
| Redis dedup store | Phase 2. In-memory is safe given Sui's protocol-level idempotency. |

---

## Review Process

- Expert panel: 5 domains (REST API, Security, Payment Systems, DevOps, Blockchain)
- Exploration agents: confirmed findings against actual codebase (2 agents)
- Skeptic agent: found 5 real issues in the initial plan:
  1. `/ready` = scheme check only (misleading name) → fixed: added real RPC ping
  2. `/stats` aggregate data = cross-tenant leak → dropped
  3. Dedup key missing apiKey → cross-tenant collision → fixed
  4. Body stream concern in middleware → confirmed false positive (Hono caches reads)
  5. 5-minute TTL too long → reduced to 60s
- All 51 tests passing after implementation. Zero type errors.
