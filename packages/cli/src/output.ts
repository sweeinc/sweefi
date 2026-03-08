/**
 * Output formatting — JSON-first with optional human-readable mode.
 *
 * Every response is a structured envelope: { ok, command, version, data/error, meta }.
 * Agents parse the JSON. Humans pass --human for a pretty table.
 *
 * The version field locks the output schema — agents can check
 * response.version for compatibility when the format evolves.
 */

import { randomUUID } from "node:crypto";
import { COIN_DECIMALS, COIN_TYPES, TESTNET_COIN_TYPES } from "@sweefi/sui";
import { formatHumanSuccess, formatHumanError } from "./format.js";

export const VERSION = "0.3.0";

export interface Meta {
  network: string;
  durationMs: number;
  cliVersion: string;
  requestId: string;
  gasCostMist?: number;
  gasCostDisplay?: string;
}

export interface SuccessEnvelope {
  ok: true;
  command: string;
  version: string;
  data: Record<string, unknown>;
  meta: Meta;
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
    retryAfterMs?: number;
  };
  meta: Meta;
}

/** Shared request context for a single CLI invocation. */
export interface RequestContext {
  requestId: string;
  startTime: number;
  network: string;
}

/** Create a request context at the start of each invocation. */
export function createRequestContext(network: string): RequestContext {
  return {
    requestId: randomUUID(),
    startTime: performance.now(),
    network,
  };
}

/** Build the meta block from request context + optional gas info. */
function buildMeta(reqCtx: RequestContext, gas?: { mist: number; display: string }): Meta {
  const meta: Meta = {
    network: reqCtx.network,
    durationMs: Math.round(performance.now() - reqCtx.startTime),
    cliVersion: VERSION,
    requestId: reqCtx.requestId,
  };
  if (gas) {
    meta.gasCostMist = gas.mist;
    meta.gasCostDisplay = gas.display;
  }
  return meta;
}

export function outputSuccess(
  command: string,
  data: Record<string, unknown>,
  human: boolean,
  reqCtx: RequestContext,
  gas?: { mist: number; display: string },
): void {
  const meta = buildMeta(reqCtx, gas);
  const envelope: SuccessEnvelope = { ok: true, command, version: VERSION, data, meta };

  if (human) {
    process.stdout.write(formatHumanSuccess(command, data));
  } else {
    process.stdout.write(JSON.stringify(envelope) + "\n");
  }
}

export function outputError(
  command: string,
  code: string,
  message: string,
  retryable = false,
  suggestedAction?: string,
  requiresHumanAction = false,
  reqCtx?: RequestContext,
  retryAfterMs?: number,
  human = false,
): void {
  if (human) {
    process.stdout.write(formatHumanError(command, code, message, retryable, suggestedAction, requiresHumanAction));
    return;
  }

  const meta = reqCtx
    ? buildMeta(reqCtx)
    : { network: "unknown", durationMs: 0, cliVersion: VERSION, requestId: randomUUID() };

  const error: ErrorEnvelope["error"] = {
    code,
    message,
    retryable,
    suggestedAction,
    ...(requiresHumanAction && { requiresHumanAction }),
    ...(retryAfterMs !== undefined && { retryAfterMs }),
  };

  const envelope: ErrorEnvelope = { ok: false, command, version: VERSION, error, meta };
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

/** Compute gas cost in MIST and display string from transaction effects. */
export function computeGas(result: { effects?: { gasUsed?: { computationCost: string; storageCost: string; storageRebate: string } } | null }): { mist: number; display: string } | undefined {
  const gas = result.effects?.gasUsed;
  if (!gas) return undefined;
  const total = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  const mist = Number(total);
  const sui = mist / 1e9;
  return { mist, display: `${sui.toFixed(6)} SUI` };
}

/** Legacy helper — returns gas as a string for backward compat in data fields. */
export function gasUsedSui(result: { effects?: { gasUsed?: { computationCost: string; storageCost: string; storageRebate: string } } | null }): string {
  const gas = computeGas(result);
  return gas ? (gas.mist / 1e9).toFixed(6) : "unknown";
}

