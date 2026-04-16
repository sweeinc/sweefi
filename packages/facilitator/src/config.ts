import { z } from "zod";

const envSchema = z.object({
  /** Port to listen on */
  PORT: z.coerce.number().default(4022),

  /** Comma-separated list of valid API keys — each key must be ≥16 characters */
  API_KEYS: z.string().min(1).refine(
    (val) => val.split(",").every((k) => k.trim().length >= 16),
    { message: "Each API key must be at least 16 characters. Short keys are trivially brute-forceable." }
  ),

  /** Fee in micro-percent (default: 5000 = 0.5%, where 1000000 = 100%) */
  FEE_MICRO_PERCENT: z.coerce.number().min(0).max(1_000_000).default(5_000),

  /** Optional: Facilitator keypair for gas sponsorship (base64-encoded) */
  FACILITATOR_KEYPAIR: z.string().optional(),

  /** Optional: Custom RPC URL for Sui mainnet */
  SUI_MAINNET_RPC: z.string().url().optional(),

  /** Optional: Custom RPC URL for Sui testnet */
  SUI_TESTNET_RPC: z.string().url().optional(),

  /** Optional: Custom RPC URL for Solana mainnet-beta */
  SOLANA_MAINNET_RPC: z.string().url().optional(),

  /** Optional: Custom RPC URL for Solana devnet */
  SOLANA_DEVNET_RPC: z.string().url().optional(),

  /** Optional: SweeFi Move package ID for event verification (anti-spoofing) */
  SWEEFI_PACKAGE_ID: z.string().optional(),

  /** Optional: Solana program IDs for event verification (anti-spoofing).
   *  Defaults to devnet program IDs if not specified.
   *  Set these to mainnet program IDs when deploying to mainnet. */
  SOLANA_PREPAID_PROGRAM_ID: z.string().optional(),
  SOLANA_STREAM_PROGRAM_ID: z.string().optional(),
  SOLANA_ESCROW_PROGRAM_ID: z.string().optional(),
  SOLANA_UPTO_PROGRAM_ID: z.string().optional(),

  /** Sui address that receives protocol fees (used in /.well-known/s402-facilitator) */
  FEE_RECIPIENT: z.string().optional(),

  /** Max gas budget (in MIST) the sponsor will co-sign per transaction (default: 10M = 0.01 SUI) */
  MAX_SPONSOR_GAS_MIST: z.coerce.number().min(1_000_000).default(10_000_000),

  /** Max sponsored transactions per key per hour (default: 100, 0 = disabled) */
  GAS_SPONSOR_MAX_PER_HOUR: z.coerce.number().min(0).default(100),

  /** Rate limiter: max tokens per key (default: 100 requests per window) */
  RATE_LIMIT_MAX_TOKENS: z.coerce.number().min(1).default(100),

  /** Rate limiter: tokens refilled per second per key (default: 10/sec) */
  RATE_LIMIT_REFILL_RATE: z.coerce.number().min(0.1).default(10),

  /** Log level */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  return envSchema.parse(process.env);
}
