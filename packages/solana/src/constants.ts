// ─── CAIP-2 network identifiers ──────────────────────────────────────────────

export const SOLANA_MAINNET_CAIP2 = 'solana:mainnet-beta' as const;
export const SOLANA_DEVNET_CAIP2 = 'solana:devnet' as const;
export const SOLANA_TESTNET_CAIP2 = 'solana:testnet' as const;

export type SolanaNetwork =
  | typeof SOLANA_MAINNET_CAIP2
  | typeof SOLANA_DEVNET_CAIP2
  | typeof SOLANA_TESTNET_CAIP2;

/**
 * Type guard to narrow string to SolanaNetwork.
 * Use this instead of `as SolanaNetwork` after a Set.has() check.
 */
export function isSolanaNetwork(network: string): network is SolanaNetwork {
  return (
    network === SOLANA_MAINNET_CAIP2 ||
    network === SOLANA_DEVNET_CAIP2 ||
    network === SOLANA_TESTNET_CAIP2
  );
}

// ─── Token mint addresses ─────────────────────────────────────────────────────

/**
 * Wrapped SOL mint address. Use as the `asset` field to request a native SOL transfer.
 * Mirrors how Solana programs treat SOL as a mint for unified token handling.
 */
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

/** USDC mint on Solana mainnet-beta */
export const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** USDC mint on Solana devnet (Circle's devnet faucet) */
export const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// ─── Token precision ──────────────────────────────────────────────────────────

export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Base fee charged per transaction signature (no priority fee). */
export const BASE_FEE_LAMPORTS = 5_000n;

/**
 * Rent-exempt minimum for an SPL token account (165 bytes).
 * Charged to the payer when creating a recipient's Associated Token Account.
 * Recoverable if the account is later closed.
 */
export const ATA_RENT_LAMPORTS = 2_039_280n;

// ─── SweeFi Anchor program IDs ────────────────────────────────────────────────

/**
 * SweeFi Prepaid program ID (deployed on devnet).
 * Used for anti-spoofing verification — ensures events came from our program.
 */
export const SWEEFI_PREPAID_PROGRAM_ID = 'FsdmgrStNw43ib6UXL4CPJ2cPHXwoSiGoMAYKppcgAxC';

/**
 * SweeFi Stream program ID (deployed on devnet).
 */
export const SWEEFI_STREAM_PROGRAM_ID = 'HMTeFyU4yXf7QB3D1WE7vQqPrZSecmeD1f5gqCauDL7M';

/**
 * SweeFi Escrow program ID (deployed on devnet).
 */
export const SWEEFI_ESCROW_PROGRAM_ID = 'AbH1dHyrGjE8P6Ti4QLSWp9zVzZZfAg26uK5DqLY12Gt';

/**
 * SweeFi Upto program ID (deployed on devnet).
 */
export const SWEEFI_UPTO_PROGRAM_ID = '7H1iJSgBnFC7fgVje5EjXHRQs9XHCFDpcFQ2aXHaovsD';
