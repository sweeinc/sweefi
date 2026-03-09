# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SweeFi, **please report it responsibly**.

**Email**: security@sweefi.xyz

**Do NOT**:
- Open a public GitHub issue for security vulnerabilities
- Post details on Discord, Twitter, or other public channels

**Do**:
- Email us with a description of the vulnerability
- Include steps to reproduce if possible
- Allow reasonable time for a fix before public disclosure

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix + Disclosure**: Coordinated with reporter

## Scope

| In Scope | Out of Scope |
|----------|-------------|
| Move smart contracts (`contracts/`) | Third-party dependencies |
| TypeScript SDK packages (`packages/`) | Sui network issues |
| s402 protocol implementation | Social engineering |
| MCP server tool authorization | Already-reported issues |

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (npm) | Yes |
| Testnet contracts | Yes |
| Mainnet contracts | Not yet deployed |

## Bug Bounty

No formal bug bounty program at this time. Significant findings will be credited in the changelog and (when appropriate) rewarded at our discretion.
