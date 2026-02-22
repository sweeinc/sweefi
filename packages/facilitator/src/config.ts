import { z } from "zod";

const envSchema = z.object({
  /** Port to listen on */
  PORT: z.coerce.number().default(4022),

  /** Comma-separated list of valid API keys — each key must be ≥16 characters */
  API_KEYS: z.string().min(1).refine(
    (val) => val.split(",").every((k) => k.trim().length >= 16),
    { message: "Each API key must be at least 16 characters. Short keys are trivially brute-forceable." }
  ),

  /** Fee in basis points (default: 50 = 0.5%) */
  FEE_BPS: z.coerce.number().min(0).max(10000).default(50),

  /** Optional: Facilitator keypair for gas sponsorship (base64-encoded) */
  FACILITATOR_KEYPAIR: z.string().optional(),

  /** Optional: Custom RPC URL for Sui mainnet */
  SUI_MAINNET_RPC: z.string().url().optional(),

  /** Optional: Custom RPC URL for Sui testnet */
  SUI_TESTNET_RPC: z.string().url().optional(),

  /** Optional: SweeFi Move package ID for event verification (anti-spoofing) */
  SWEEFI_PACKAGE_ID: z.string().optional(),

  /** Sui address that receives protocol fees (used in /.well-known/s402-facilitator) */
  FEE_RECIPIENT: z.string().optional(),

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
