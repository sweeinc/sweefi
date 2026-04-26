# SweeFi Threat Model (Draft)

**Status:** Draft v0.1 · 2026-04-19 · to be hardened in waves
**Scope:** SweeFi's operational and implementation layers — facilitator deployment, chain adapters (`@sweefi/sui`, `@sweefi/solana`), client SDK, MCP server, UI packages, extension sandbox. Protocol-layer threats belong in `s402/docs/THREAT_MODEL.md`.

---

## 1. Attacker models

### A1. Malicious facilitator operator
Runs a facilitator deployment claiming to be s402-compliant. Can steal funds, censor, correlate, sign dishonest attestations.

### A2. Malicious API-key holder
Legitimate tenant of a SweeFi-hosted facilitator abusing resources or trying to escape the sandbox to see other tenants.

### A3. Malicious chain-adapter consumer
Imports `@sweefi/sui` into an agent, then crafts payloads to exploit adapter bugs.

### A4. Malicious extension author (SweeFi extensions)
Publishes a SweeFi extension (scheme handler, event hook, UI plugin) that appears legitimate but escalates privileges or siphons data.

### A5. Malicious MCP client
Connects to SweeFi MCP server, attempts to use tools beyond authorized scope.

### A6. Network attacker targeting SweeFi infrastructure
DDoS, credential theft from fly.io, DNS hijack, TLS certificate misissuance.

### A7. Insider threat (future, when team > 1)
Person with deploy access who acts adversarially.

### A8. Supply-chain attacker
Malicious dependency in `@sweefi/*` or in a transitive dep.

---

## 2. Asset inventory

- **Operator funds** — gas sponsor balance, facilitator fee accrual.
- **Tenant data** — usage metrics, settlement history, per-API-key events.
- **Private keys** — facilitator signing key (attestations), gas sponsor key (if present).
- **Brand integrity** — "hosted SweeFi facilitator is safe to trust" depends on ops discipline.
- **Extension registry integrity** — which extensions SweeFi endorses affects real-money flows.

---

## 3. Facilitator operational threats

### T1. API-key brute force (A2, A6)
**Attack:** Attacker enumerates short/predictable API keys via the `/settle` endpoint.
**Defense (existing):** Minimum 16-char key entropy enforced at startup; constant-time comparison; rate limiter (100 rps, 10 rps refill) per key.
**Defense (planned):** Add IP-rate-limit floor for unauthenticated routes behind a trusted proxy.
**Residual risk:** Keys with <32 chars are brute-forceable if the attacker has months; documentation urges 32+ hex from CSPRNG.

### T2. API-key leakage via logs (A2, A7)
**Attack:** API keys appear in log output (request headers, crash dumps) and are exfiltrated.
**Defense:** Log redaction middleware MUST strip `Authorization` headers. Audit: grep logs for bearer tokens on deploy.
**Residual risk:** Third-party log aggregators (fly.io logs, Sentry) — assume keys can leak there and enforce rotation discipline.

### T3. Facilitator-key theft (A1 exfil, A6, A7)
**Attack:** Private signing key (`FACILITATOR_KEYPAIR`) stolen from the host. Attacker signs fraudulent attestations impersonating the real facilitator.
**Defense:** Key stored in fly.io secrets (never in repo); env vars not logged; key rotation procedure documented.
**Defense (planned):** Hardware-backed key custody for production facilitator (e.g., fly.io + Turnkey or GCP KMS).
**Residual risk:** Host compromise at the root level. Mitigation: one-button key rotation + attestation revocation list.

### T4. On-chain fee bypass via PTB manipulation (A1)
**Attack:** Malicious facilitator constructs PTBs that reduce or skip the protocol fee.
**Defense:** Move contract balance-conservation enforcement — fee split is at the contract layer, not the facilitator layer. Facilitator cannot reduce fees without modifying Move code (visible in on-chain package).
**Defense (ongoing):** `SWEEFI_PACKAGE_ID` set in production so facilitator verifies events originate from the legitimate package; unset = prominent startup warning.
**Residual risk:** Facilitator deploys a fork with altered fee logic. Mitigation: package ID pinning + canonical package publication.

### T5. Usage-tracker inconsistency (A1, A2)
**Attack:** Phase-1 `UsageTracker` is in-memory → facilitator restart loses state → tenants may escape per-key caps. Alternatively, tracker drifts between multiple instances behind a load balancer.
**Defense:** `IUsageTracker` interface allows swap to persistent backend (Redis, Postgres, or on-chain).
**Defense (planned):** Wave 2 — ship Postgres-backed UsageTracker. Hash-chain event log so drift is detectable.
**Residual risk:** Phase 1 only suitable for single-instance deployments.

### T6. Request body DoS (A6)
**Attack:** Attacker submits 256KB requests at the body limit to exhaust CPU during Zod validation.
**Defense:** 256KB body cap; rate limiter; structured validation fails fast on shape mismatch.
**Residual risk:** Zod deep validation for large scheme payloads could be expensive. Mitigation: scheme-handler-specific caps (prepaid receipt chain may need lower cap than exact).

### T7. Rate-limiter bypass via IP spoofing (A6)
**Attack:** Attacker forges `x-forwarded-for` header to reset rate-limit bucket.
**Defense (existing):** Rate limiter uses API key when authenticated; IP fallback only for `/health` and discovery endpoints.
**Residual risk:** If facilitator is directly exposed without a trusted proxy, IP-based limits are spoofable. Deployment guide mandates Fly.io/Cloudflare fronting.

### T8. Fly.io platform compromise (A6)
**Attack:** Fly.io is compromised; attacker deploys a malicious image or siphons secrets.
**Defense:** Acknowledged platform risk. Mitigation: secret rotation cadence + attestation log (future: anchor daily events to Walrus + Sui for tamper-evidence).

---

## 4. Chain adapter threats (@sweefi/sui, @sweefi/solana)

### T9. Settlement verification bypass (A1)
**Attack:** Chain adapter's `verifySettlement` skipped by client SDK consumer, allowing facilitator to claim settlement without a real on-chain tx.
**Defense:** S8 / ADR-007 — `verifySettlement` is auto-wired into `createS402Client`; consumers using the client wrapper cannot opt out. Direct facilitator callers must opt in (documented).
**Residual risk:** Downstream consumers bypass the wrapper. Mitigation: lint rule `no-direct-facilitator-call` in `@sweefi/sdk` eslint preset.

### T10. Event spoofing from attacker-deployed Move package (A3)
**Attack:** Attacker deploys a Move package that emits events with the same structural shape as legitimate SweeFi events, tricks facilitator/adapter into trusting them.
**Defense (existing):** `SWEEFI_PACKAGE_ID` check — scheme handlers reject events not originating from the legitimate package.
**Defense (planned):** Explicit typeof validation on every event field (see memory `technique_sui_event_explicit_validation.md`). Already applied across all four SweeFi facilitator schemes (April 16, 2026).
**Residual risk:** `SWEEFI_PACKAGE_ID` not set (startup warns loudly).

### T11. BCS decode panic / input confusion (A3)
**Attack:** Malformed BCS bytes in signed transaction payload cause adapter panic or silently-wrong decode.
**Defense:** Adapter wraps BCS decode in try/catch; failures return typed s402Error, never uncaught exceptions.
**Residual risk:** BCS library bugs. Tracked with pinned `@mysten/bcs` version + alert on advisories.

### T12. Unlock-TX2 attestation forgery at adapter layer (A1)
**Attack:** Adapter does not verify S11 attestation chain; decrypts SEAL content based on facilitator's word alone.
**Defense:** `@sweefi/sui` unlock adapter MUST invoke `verifyUnlockAttestation` before SEAL decrypt. Test coverage mandatory.
**Status:** Planned for v0.6.1 (tracked in ADR-008 Phase 3).

---

## 5. Client SDK threats (@sweefi/sdk, @sweefi/hono, etc.)

### T13. compute_budget bypass (A3 client of the SDK)
**Attack:** Agent wraps `@sweefi/sdk` but bypasses the budget middleware, bankrupting itself on Opus calls.
**Defense (planned, harvested from archived marketplace thesis):** `compute_budget` middleware included in `createS402Client` default path. Agents who want to opt-out must explicitly call the lower-level client. Budget enforcement before the call, not after — facilitator-side rate-limit is defense-in-depth (T17).
**Status:** Draft design — see `s402-project/knowledge/harvested-from-marketplace.md` §4.

### T14. Multi-facilitator fallback misrouting (A1)
**Attack:** SDK accepts a list of facilitators. A malicious facilitator in the list is selected via biased fallback logic; legitimate facilitator never tried.
**Defense (planned):** Facilitator selection uses reputation signal (see reputation primitive design, Wave 3). Ordering is not caller-controlled beyond stated preferences.
**Residual risk:** Reputation primitive itself gameable (see T20).

### T15. Local key exposure via SDK logs (A3 client of the SDK)
**Attack:** SDK debug mode prints signed payload bytes including the transaction. BCS bytes don't expose keys, but log exfiltration reveals settlement patterns.
**Defense:** SDK never logs keys. Signed transaction bytes MAY be logged in debug mode but are prefixed with a "DO NOT SHARE" marker. Debug mode off by default.

---

## 6. MCP server threats (@sweefi/mcp)

### T16. Unauthorized tool invocation via MCP client (A5)
**Attack:** MCP client invokes SweeFi tools beyond its authorized scope (e.g., `settle` when only `verify` was granted).
**Defense:** MCP capability declaration + per-tool auth check. Each tool declares `requires: ["facilitator-key:<id>"]` or similar; server rejects invocations without matching capability.
**Residual risk:** Capability system is Wave 2 work. Today, scope is coarse.

### T17. MCP prompt injection attack (A5)
**Attack:** Malicious input in tool arguments triggers unintended tool chains (e.g., an argument string that reads as a prompt to an LLM driver that then calls `settle` unexpectedly).
**Defense:** MCP server does NOT interpret arguments as prompts. Tool arguments are strongly typed (Zod). This is the LLM driver's concern, not MCP's — but documented prominently in MCP README.
**Residual risk:** LLM drivers not applying prompt-safety. Outside SweeFi's scope but we publish a recommended LLM-driver hardening checklist.

---

## 7. Extension + plugin architecture threats

### T18. Malicious SweeFi extension (A4)
**Attack:** Published extension contains code that exfils data, siphons funds, or weakens scheme invariants.
**Defense:** Extension sandbox (Wave 2 design work). Options under consideration: `isolated-vm`, `vm2` successor, WebAssembly runtime. Extensions declared in manifest; runtime rejects behavior not in manifest.
**Defense (protocol-layer):** S10 (Extension Additivity) — extensions cannot relax scheme invariants.
**Residual risk:** Sandbox escape. Mitigated by publishing review: every first-party extension audited; third-party extensions carry `unofficial` badge until reviewed.

### T19. Extension dependency supply-chain attack (A8)
**Attack:** Legitimate extension author's npm account compromised; malicious version published.
**Defense:** Lock files; npm audit in CI; optional extension pinning by package hash in SweeFi facilitator config.
**Residual risk:** Trust-on-first-use. Mitigation: daily `npm audit` + Socket.dev integration.

---

## 8. Reputation + identity threats (Wave 3 work)

### T20. Sybil attack on facilitator reputation (A1)
**Attack:** Attacker creates 50 sybil DIDs, each "rates" the attacker's own facilitator 5 stars, fabricating reputation.
**Defense (design):**
- Stake-gated raters: rating-weight proportional to on-chain stake.
- Rater-cohort sybil detection: graph-based clustering of raters who consistently co-rate.
- Cap on ratings-per-rater per target per rolling window.
- Do NOT use Bayesian prior α=8 (harvested-from-marketplace.md warned this helps attackers).
**Status:** Design phase. No shipping code yet. Block on design before launching reputation product.

### T21. Reputation data poisoning (A1, A7)
**Attack:** Attacker submits truthful but cherry-picked ratings about a competitor to depress score.
**Defense:** Ratings are tied to settled payments (can't rate a facilitator you never paid). Negative ratings require verification trail.
**Residual risk:** Low-volume targets have high variance. Bayesian *posterior* (not prior) shrinkage appropriate here — apply AFTER sybil defense.

### T22. Identity impersonation of a known facilitator (A1)
**Attack:** Attacker deploys a facilitator claiming to be `swee-facilitator.fly.dev` via DNS/TLS spoofing or by running a near-identical domain.
**Defense:** Facilitator identity document (`.well-known/s402-facilitator`) will be JWS-signed (current TODO — see facilitator README). Clients verify signature against a pre-registered pubkey.
**Status:** Signature field reserved; implementation pending `FACILITATOR_KEYPAIR` production deployment.

---

## 9. Supply-chain threats

### T23. Malicious dependency in @sweefi/* (A8)
**Attack:** A dependency of `@sweefi/sui` (or transitive) is compromised.
**Defense:** Lockfiles, `pnpm audit`, Socket.dev, Dependabot. Sensitive deps (e.g., `@mysten/sui`, `@mysten/bcs`) pinned to exact versions with advisory subscriptions.
**Residual risk:** Zero-day in a trusted dep. Standard ecosystem risk.

### T24. Release pipeline compromise (A7, A8)
**Attack:** CI-published npm package contains modified code vs git repo.
**Defense (planned):** Reproducible builds; npm provenance (`npm publish --provenance`); published packages carry an attestation of git commit SHA.
**Status:** Research phase. Prioritize after v1.0 of s402.

---

## 10. Known gaps (explicit)

- **G1. No facilitator reputation primitive ships today.** Clients must trust `swee-facilitator.fly.dev` by brand. Design in Wave 3.
- **G2. Extension sandbox not shipped.** Today, only first-party code runs in facilitator. Third-party extensions gated behind sandbox work.
- **G3. MCP capability system coarse.** Scope-level auth not per-tool. Wave 2.
- **G4. Facilitator identity document not yet signed.** Planned when `FACILITATOR_KEYPAIR` is production-deployed.
- **G5. Usage tracker is in-memory (Phase 1).** Single-instance only. Postgres backend in Wave 2.

---

## 11. Hardening waves

- **Wave 1 (this quarter):** Ship S11 attestation verification in `@sweefi/sui` unlock adapter. Ship compute_budget middleware. Postgres-backed UsageTracker. Facilitator identity signing.
- **Wave 2:** Extension sandbox (design → prototype → first-party-only → third-party allowlist). MCP capability system refinement.
- **Wave 3:** Reputation primitive (stake-gated). Multi-facilitator fallback with reputation-aware selection.
- **Wave 4:** External audit ($25K budget across ≥2 firms). Public bug bounty on Immunefi post-mainnet.

---

## 12. Disclosure policy

See `SECURITY.md` at repo root. Vulnerabilities in SweeFi implementations (adapters, facilitator, SDK wrappers) → disclose to SweeFi maintainers. Vulnerabilities in s402 the protocol → disclose to s402 maintainers.

---

## 13. Revision history

- v0.1 (2026-04-19): Initial draft. 24 threats catalogued across 8 categories. 5 known gaps explicit.
