/**
 * Output formatting — JSON-first with optional human-readable mode.
 *
 * Every response is a structured envelope: { ok, command, version, data/error }.
 * Agents parse the JSON. Humans pass --human for a pretty table.
 *
 * The version field locks the output schema — agents can check
 * response.version for compatibility when the format evolves.
 */

import { COIN_DECIMALS, COIN_TYPES, TESTNET_COIN_TYPES } from "@sweefi/sdk";

const VERSION = "0.1.0";

export interface SuccessEnvelope {
  ok: true;
  command: string;
  version: string;
  data: Record<string, unknown>;
}

export interface ErrorEnvelope {
  ok: false;
  command: string;
  version: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    suggestedAction?: string;
    /** True when only a human (not the agent) can resolve this. */
    requiresHumanAction?: boolean;
  };
}

export function outputSuccess(command: string, data: Record<string, unknown>, human: boolean): void {
  const envelope: SuccessEnvelope = { ok: true, command, version: VERSION, data };

  if (human) {
    printHuman(command, data);
  } else {
    process.stdout.write(JSON.stringify(envelope) + "\n");
  }
}

export function outputError(command: string, code: string, message: string, retryable = false, suggestedAction?: string, requiresHumanAction = false): void {
  const envelope: ErrorEnvelope = {
    ok: false,
    command,
    version: VERSION,
    error: { code, message, retryable, suggestedAction, ...(requiresHumanAction && { requiresHumanAction }) },
  };
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

/** Format a base-unit balance into human-readable form. */
export function formatBalance(amount: string | bigint, coinType: string): string {
  const decimals = COIN_DECIMALS[coinType] ?? 9;
  const raw = BigInt(amount);
  const whole = raw / BigInt(10 ** decimals);
  const frac = raw % BigInt(10 ** decimals);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "") || "0";
  return `${whole}.${fracStr} ${getSymbol(coinType)}`;
}

/** Get a human-readable symbol for a coin type. */
export function getSymbol(coinType: string): string {
  if (coinType === COIN_TYPES.SUI || coinType.endsWith("::sui::SUI")) return "SUI";
  if (coinType === COIN_TYPES.USDC || coinType === TESTNET_COIN_TYPES.USDC || coinType.includes("::usdc::USDC")) return "USDC";
  if (coinType === COIN_TYPES.USDT || coinType.includes("::coin::COIN")) return "USDT";
  return coinType.length > 20 ? `${coinType.slice(0, 10)}...` : coinType;
}

/** Explorer URL for a given transaction digest. */
export function explorerUrl(network: string, digest: string): string {
  const base = network === "mainnet" ? "https://suiscan.xyz/mainnet" : `https://suiscan.xyz/${network}`;
  return `${base}/tx/${digest}`;
}

/** Pretty-print for --human mode. */
function printHuman(command: string, data: Record<string, unknown>): void {
  const lines: string[] = [`${command} successful\n`];
  const maxKeyLen = Math.max(...Object.keys(data).map((k) => k.length));
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      lines.push(`  ${key.padEnd(maxKeyLen + 2)}${value}`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}
