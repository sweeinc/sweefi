# SweeFi Mainnet Deployment Checklist

**Purpose:** Step-by-step runbook for mainnet package publication.
Run this in order. Do not skip steps. Each item has a checkbox and a verification method.

> References: ADR-004 (AdminCap & Emergency Pause), ADR-006 (Object Ownership Model)

---

## Phase 0 — Pre-Deploy Gates

These must all be true before touching mainnet.

- [ ] **All tests pass on latest commit**
  ```
  cd contracts && sui move test
  ```
  Expected: all tests pass, 0 failures.

- [ ] **At least one external audit completed**
  Minimum: adversarial review by a qualified Move engineer not on the core team.
  Document the audit report path here: `docs/audits/_____.md`

- [ ] **fee_bps denominator is 1_000_000 in math.move**
  Confirm `FEE_DENOMINATOR: u128 = 1_000_000` in `sources/math.move`.
  Reason: changing this post-launch is a breaking migration.

- [ ] **Package is NOT marked upgradeable**
  Confirm `Move.toml` does NOT set `upgrade-policy = "compatible"` or similar.
  Immutability is intentional — see ADR-004.

---

## Phase 1 — Multisig Setup (CRITICAL — do before publishing)

> Rationale: `AdminCap` is minted in `init()` and sent to the publisher address.
> If published from a hot wallet, the protocol's emergency pause is controlled by a
> single private key. One key compromise = attacker can pause operations.
> See ADR-004 §AdminCap Custody for the full design rationale.

- [ ] **Generate the 3 multisig component keys**

  Three separate keys, stored separately:
  - Key 1: Danny (founder) — hardware wallet recommended
  - Key 2: Operational cold storage — air-gapped or hardware wallet
  - Key 3: Trusted third party / future team member

  ```bash
  # Generate keys (do this on separate secure machines if possible)
  sui keytool generate ed25519
  ```

- [ ] **Create the 2-of-3 Sui multisig address**

  ```bash
  sui keytool multi-sig-address \
    --pks <pubkey1> <pubkey2> <pubkey3> \
    --weights 1 1 1 \
    --threshold 2
  ```

  Record the multisig address: `0x___________________________`

- [ ] **Fund the multisig address with enough SUI for gas**
  Minimum: 0.1 SUI for initial transactions.

- [ ] **Verify the multisig address can sign a test transaction**
  Send a small SUI transfer from the multisig address using 2 of the 3 keys.
  Do NOT proceed until you have confirmed 2-of-3 signing works end-to-end.

---

## Phase 2 — Publish the Package

- [ ] **Publish from a temporary deployer key (NOT the multisig)**

  The `init()` function sends `AdminCap` to `ctx.sender()`. Publish from
  a fresh key so you can immediately transfer the cap in the next step.

  ```bash
  sui client publish --gas-budget 200000000
  ```

  Record:
  - Package ID: `0x___________________________`
  - AdminCap object ID: `0x___________________________`
  - ProtocolState object ID: `0x___________________________`

- [ ] **Immediately transfer AdminCap to the multisig address**

  This is the single most important post-publish step. Do it in the same
  session, before anything else.

  ```bash
  sui client transfer \
    --to <multisig-address> \
    --object-id <AdminCap-object-id> \
    --gas-budget 10000000
  ```

  Verify on-chain: confirm the AdminCap owner is the multisig address, NOT
  the deployer key.

  ```bash
  sui client object <AdminCap-object-id>
  ```

  Expected: `owner: { AddressOwner: <multisig-address> }`

- [ ] **Verify deployer key no longer controls AdminCap**
  The deployer key should now hold zero admin capability.
  Consider sending any remaining SUI from the deployer key back to a cold wallet.

---

## Phase 3 — Smoke Tests on Mainnet

- [ ] **Test stream creation works (unpaused)**
  Create a small test stream (1_000_000 MIST = 0.001 SUI).
  Confirm `StreamCreated` event is emitted.

- [ ] **Test pause/unpause via multisig**
  Using 2-of-3 signatures, call `admin::pause`.
  Confirm new stream creation fails with `EAlreadyPaused`.
  Call `admin::unpause`.
  Confirm stream creation succeeds again.

- [ ] **Confirm ProtocolState object ID in SDK config**
  Update `packages/sui/src/ptb/deployments.ts` with:
  - Package ID
  - ProtocolState object ID

---

## Phase 4 — Post-Deploy Documentation

- [ ] **Record all object IDs in a permanent location**

  | Object | ID | Network |
  |---|---|---|
  | Package | `0x...` | mainnet |
  | AdminCap | `0x...` | mainnet |
  | ProtocolState | `0x...` | mainnet |

- [ ] **Publish the pause policy**
  Public commitment covering:
  - Under what conditions will the protocol be paused?
    (Answer: active exploits only, not market conditions or business decisions)
  - Maximum pause duration before unpause or new package migration?
  - How will users be notified? (Twitter/X, Discord, on-chain event)

- [ ] **Document the burn timeline**
  Per ADR-004: AdminCap will be burned after first external audit + N months
  of clean mainnet operation. Record the target milestone here.
  Target milestone: `___________________________`

---

## Phase 5 — AdminCap Burn (Future)

Run this only after the burn criteria in Phase 4 are met.

- [ ] **Confirm protocol is unpaused before burning**
  `burn_admin_cap` will abort if `state.paused == true`.
  This is intentional — cannot burn cap while frozen (M-1 fix, ADR-004).

- [ ] **Execute burn via multisig (2-of-3)**
  ```bash
  # Call admin::burn_admin_cap with AdminCap and ProtocolState
  ```

- [ ] **Verify AdminCapBurned event on-chain**
  This event is permanent, indexable proof that the protocol is irrevocably trustless.

- [ ] **Announce publicly**
  The burn is a milestone. Publish the transaction hash.

---

## Quick Reference: What AdminCap Can and Cannot Do

| Action | AdminCap Required? |
|---|---|
| Pause new stream/escrow/prepaid creation | Yes |
| Unpause | Yes |
| Burn the cap (irrevocable) | Yes |
| Withdraw user funds | **No — impossible** |
| Change fee rates | **No — impossible** |
| Modify contract logic | **No — impossible** |
| Block user withdrawals/claims | **No — impossible** |

> The two-tier pause model guarantees: pausing the protocol can never trap user funds.
> Close, claim, release, and refund are always available regardless of pause state.
