import { z } from "zod";

const envSchema = z.object({
  /** Port to listen on */
  PORT: z.coerce.number().default(4022),

  /** Comma-separated list of valid API keys */
  API_KEYS: z.string().min(1),

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

  /** Log level */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  return envSchema.parse(process.env);
}
