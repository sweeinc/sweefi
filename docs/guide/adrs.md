# Architecture Decision Records

These documents capture the **why** behind SweeFi's key design decisions. Read the relevant ADR before proposing changes to load-bearing architecture.

| ADR | Title | Core Decision |
|-----|-------|---------------|
| [001](/adr/001-composable-ptb-pattern) | Composable PTB Pattern | `public` functions return objects; `entry` functions transfer them. Enables PTB composition. |
| [002](/adr/002-batch-claims-gas-economics) | Batch Claims & Gas Economics | Break-even at ~17s claim intervals; recommend 5min+ batches for prepaid. |
| [003](/adr/003-fee-rounding-financial-precision) | Fee Rounding & Financial Precision | u128 intermediates, micro-percent denominator (1M = 100%), always round in protocol's favor. |
| [004](/adr/004-admin-cap-emergency-pause) | AdminCap & Emergency Pause | Admin can pause deposits but NEVER extract funds. Exits always open. |
| [005](/adr/005-permissive-access-receipt-transferability) | Permissive Access & Receipt Transferability | Bearer receipt = access. `seal_approve` must NEVER check `ctx.sender()`. |
| [006](/adr/006-object-ownership-model) | Object Ownership Model | Receipts are owned (transferable). StreamingMeters are shared. Escrows are shared. |
| [007](/adr/007-prepaid-trust-model) | Prepaid Trust Model | Provider can freeze balance but agent can always withdraw after deadline. Permissionless recovery. |
| [008](/adr/008-facilitator-api-gaps) | Facilitator API Surface Gaps | Identified API surface gaps; led to body validation, field stripping, dedup middleware. |
| [009](/adr/009-ap2-agent-mandate-integration) | AP2 Agent Mandate Integration | SweeFi mandates as AP2-compatible payment method. `validate_and_spend` compose pattern. |

## How to Read ADRs

Each ADR follows the structure:
- **Context**: What problem we faced
- **Decision**: What we chose and why
- **Consequences**: What trade-offs we accepted

## When to Write a New ADR

Write an ADR when you're making a decision that:
- Changes how packages compose or interact
- Affects the trust model or security properties
- Would surprise a future contributor if they encountered it without context
- Has multiple valid approaches and the choice isn't obvious
