# SEAL Pattern Proposal Backlog (Issue-Ready)

Purpose: fast-track high-impact SEAL ecosystem proposals to Sui via GitHub issues.

How to use:
1. Start with P0 and P1 proposals.
2. Open each as a separate issue in MystenLabs/SEAL repos.
3. Link back to SweePay use cases (escrow receipts, streaming meters, delegated agent access).

---

## P0: File Immediately

### 1) Standard Receipt-Gated Access Trait
- **Issue title:** `SEAL: Standardized Receipt-Gated Access Interface for Move Policies`
- **Problem:** Every protocol hand-rolls receipt ownership checks, causing inconsistent policy semantics.
- **Proposal:** Publish a canonical interface/pattern for "receipt-like credential" checks (owner, scope, expiry).
- **Acceptance criteria:** example policy module + docs + compatibility guidance.
- **SweePay impact:** cleaner pay-to-decrypt interoperability across payment protocols.

### 2) Dry-Run Error Normalization
- **Issue title:** `SEAL: Normalize Dry-Run Failure Codes for Policy Evaluation`
- **Problem:** Policy abort diagnostics are inconsistent and hard for clients/agents to interpret.
- **Proposal:** Standard error schema for dry-run policy failures (auth, malformed id, expired, revoked, mismatch).
- **Acceptance criteria:** error code spec + SDK mapping helpers.
- **SweePay impact:** fewer support/debug loops when decrypt requests fail.

### 3) Deterministic Policy Input Envelope
- **Issue title:** `SEAL: Typed Policy Input Envelope for Key-Server Evaluations`
- **Problem:** `vector<u8>` payload conventions are fragile across projects.
- **Proposal:** canonical envelope format (version, policy_id, context fields, nonce domain).
- **Acceptance criteria:** reference serializer/parser in TS + Move docs.
- **SweePay impact:** safer escrow-id + nonce composition, fewer parsing bugs.

### 4) Ownership-at-Time-of-Request Semantics
- **Issue title:** `SEAL: Clarify Ownership Semantics for Transferable Credentials`
- **Problem:** teams differ on "original payer" vs "current owner" authorization semantics.
- **Proposal:** explicit policy guidance and examples for both models.
- **Acceptance criteria:** docs section + decision matrix for protocol designers.
- **SweePay impact:** clearer receipts transferability UX and threat model messaging.

### 5) Policy Simulation Test Harness
- **Issue title:** `SEAL: Official Local Policy Simulation Harness for CI`
- **Problem:** testing key-server dry-run policy behavior is fragmented.
- **Proposal:** local harness/fixture package to simulate policy evaluation deterministically.
- **Acceptance criteria:** CLI + CI-ready examples.
- **SweePay impact:** reliable SEAL integration tests before live testnet runs.

---

## P1: High Value

### 6) Delegated Access Capability Pattern
- **Issue title:** `SEAL: Delegated Access Capability Pattern (Owner -> Agent)`
- **Problem:** users need to delegate decrypt rights without delegating funds keys.
- **Proposal:** standard capability/attestation pattern for temporary delegated decryption rights.
- **Acceptance criteria:** reference flow + revocation guidance.
- **SweePay impact:** cleaner human-payer/agent-consumer flows.

### 7) Scoped Nonce Domains
- **Issue title:** `SEAL: Scoped Nonce Domain Standard to Prevent Cross-App Reuse`
- **Problem:** nonce collisions/reuse risks across applications.
- **Proposal:** namespace schema for nonce domains (`app/protocol/resource`).
- **Acceptance criteria:** spec snippet + helper libs.
- **SweePay impact:** safer multi-object pay-to-decrypt within one escrow context.

### 8) Time-Bound Policy Macros
- **Issue title:** `SEAL: Reusable Time-Bound Access Policy Templates`
- **Problem:** expiration logic is reimplemented repeatedly and incorrectly.
- **Proposal:** shared templates/macros for TTL, not-before, and grace windows.
- **Acceptance criteria:** policy cookbook with secure defaults.
- **SweePay impact:** native support for expiring receipts/content leases.

### 9) Revocation Registry Pattern
- **Issue title:** `SEAL: Optional Revocation Registry Pattern for Bearer Credentials`
- **Problem:** transferable credentials may need emergency revocation for some applications.
- **Proposal:** optional revocation list architecture with auditability tradeoffs.
- **Acceptance criteria:** reference Move pattern + performance notes.
- **SweePay impact:** enterprise-tier controls without breaking open protocol defaults.

### 10) Multi-Condition Policy Composer
- **Issue title:** `SEAL: Composable AND/OR Policy Conditions (Ownership + Balance + Time)`
- **Problem:** complex access logic gets monolithic and unsafe.
- **Proposal:** composable policy building blocks for AND/OR condition trees.
- **Acceptance criteria:** tested examples + gas guidance.
- **SweePay impact:** rich "paid + active stream + within SLA" access controls.

### 11) Stream-Balance-Gated Decrypt Pattern
- **Issue title:** `SEAL: Reference Pattern for Stream-Balance-Gated Decryption`
- **Problem:** pay-as-you-go content streaming lacks a standard decrypt gate pattern.
- **Proposal:** canonical integration between metered balances and chunk decryption permissions.
- **Acceptance criteria:** end-to-end guide (meter state -> policy decision).
- **SweePay impact:** direct fit for streaming micropayment content delivery.

### 12) Payment-Progressive Access Pattern
- **Issue title:** `SEAL: Progressive Access by Payment Milestones (Tiered Unlocks)`
- **Problem:** many products need staged access unlocks, not binary paid/unpaid.
- **Proposal:** standard policy shape for milestone-based unlock tiers.
- **Acceptance criteria:** sample schemas and UX guidance.
- **SweePay impact:** supports partial release products and subscription-like flows.

---

## P2: Medium-Term Ecosystem Multipliers

### 13) Cross-Protocol Receipt Credential Schema
- **Issue title:** `SEAL: Cross-Protocol Credential Schema for Payment Receipts`
- **Problem:** each protocol's credential type is bespoke, reducing composability.
- **Proposal:** common schema for credential metadata fields.
- **Acceptance criteria:** schema draft + adoption examples.
- **SweePay impact:** easier interoperability with other payment rails.

### 14) Key-Server Audit Event Standard
- **Issue title:** `SEAL: Standard Audit Events for Access Decisions`
- **Problem:** access decision observability differs across implementations.
- **Proposal:** structured event schema for grant/deny decisions.
- **Acceptance criteria:** event field list + privacy notes.
- **SweePay impact:** enterprise-friendly forensic logs for disputes/compliance.

### 15) Privacy-Preserving Policy Context Hints
- **Issue title:** `SEAL: Minimal Context Hint Channel for Better Client UX`
- **Problem:** clients need actionable deny reasons without leaking sensitive data.
- **Proposal:** bounded hint taxonomy for policy denials.
- **Acceptance criteria:** hint codes + security guidance.
- **SweePay impact:** improved agent retry behavior and user messaging.

### 16) Policy Version Negotiation
- **Issue title:** `SEAL: Policy Version Negotiation and Migration Strategy`
- **Problem:** policy evolution can break existing encrypted artifacts.
- **Proposal:** recommended versioning and migration mechanism.
- **Acceptance criteria:** compatibility matrix + migration playbook.
- **SweePay impact:** safe evolution as SweePay policy logic matures.

### 17) Batch Access Verification API
- **Issue title:** `SEAL: Batch Policy Evaluation for Multi-Asset Requests`
- **Problem:** N decrypt checks create overhead and latency.
- **Proposal:** batch evaluation API with deterministic per-item results.
- **Acceptance criteria:** API design + response schema.
- **SweePay impact:** lower latency for multi-file paid bundles.

### 18) Rate-Limit Friendly Key-Server Pattern
- **Issue title:** `SEAL: Recommended Anti-Abuse Pattern for Repeated Failed Requests`
- **Problem:** brute-force and spam attempts against policy endpoints.
- **Proposal:** key-server side anti-abuse guidance that preserves decentralization.
- **Acceptance criteria:** policy-agnostic mitigation playbook.
- **SweePay impact:** protects public paywall endpoints from abuse.

### 19) Policy Fuzzing Corpus
- **Issue title:** `SEAL: Shared Fuzz Corpus for Policy Input Hardening`
- **Problem:** malformed policy payloads can trigger edge-case bugs.
- **Proposal:** community-maintained fuzz corpus and test harness.
- **Acceptance criteria:** starter corpus + CI examples.
- **SweePay impact:** stronger parser/input resilience.

### 20) Wallet UX Standard for SEAL Credentials
- **Issue title:** `SEAL: Wallet UX Guidelines for Bearer Credential Objects`
- **Problem:** users do not understand credential transfer implications.
- **Proposal:** UX copy and warning standards for transferable access credentials.
- **Acceptance criteria:** guideline doc + reference mockups.
- **SweePay impact:** fewer user errors around receipt transfers.

---

## Suggested Filing Order (This Week)

Day 1:
- #1 Standard Receipt-Gated Access Trait
- #2 Dry-Run Error Normalization
- #3 Deterministic Policy Input Envelope

Day 2:
- #4 Ownership Semantics
- #5 Policy Simulation Harness
- #6 Delegated Access Capability

Day 3:
- #7 Scoped Nonce Domains
- #10 Multi-Condition Composer
- #11 Stream-Balance-Gated Decrypt

