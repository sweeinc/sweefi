# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SweeFi, **please report it responsibly** via one of:

- [GitHub private security advisory](https://github.com/sweeinc/sweefi/security/advisories/new) (preferred)
- Email: **security@sweefi.xyz**

This keeps reports private, tracked, and convertible into security advisories. Please include:
- Description of the vulnerability
- Steps to reproduce
- Affected package(s) and version(s)
- Potential impact

We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days.

## Scope

### In Scope

- All `@sweefi/*` npm packages
- Move smart contracts in `contracts/`
- The facilitator service (`packages/facilitator`)
- The s402 protocol implementation

### Out of Scope

- Demo applications (`demos/`)
- Documentation site (`docs/`)
- Third-party dependencies (report upstream)
- Social engineering attacks

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Security Design

SweeFi's architecture prioritizes security by design:

- **Settle-first model**: Payments are atomic on-chain transactions (PTBs), not off-chain promises. No temporal gap between authorization and settlement.
- **No private key custody**: The facilitator never holds private keys. Clients sign transactions locally; the facilitator only verifies and broadcasts.
- **On-chain enforcement**: Spending limits, revocation, and authorization are enforced by Move smart contracts — not by trusted servers.
- **Two-tier pause**: AdminCap-gated emergency pause (Move) + server-side circuit breaker (facilitator).

## Audit History

- **V8 Audit (Feb 2026)**: Internal security review. 3 HIGH, 4 MEDIUM, 4 LOW findings — all resolved. See `AGENTS.md` for details.

## Known Limitations

- zkLogin signature verification is not yet supported in the facilitator. Use Ed25519 or Secp256k1 keypairs for agent wallets.
- Smart contracts are deployed to **testnet only**. Mainnet deployment pending formal third-party audit.
- The facilitator is a trust component for the Exact payment scheme. For trustless payments, use Prepaid or Escrow schemes with direct on-chain settlement.

## Disclosure Timeline

1. Report received → acknowledgment within 48 hours
2. Initial assessment within 7 days
3. Fix developed and tested
4. Coordinated disclosure after fix is deployed
5. Credit to reporter (unless anonymity requested)
