/**
 * sweefi doctor — Setup diagnostics.
 *
 * Checks everything an agent or user needs to operate:
 *   - CLI version
 *   - Network configuration
 *   - Wallet (SUI_PRIVATE_KEY)
 *   - Package ID
 *   - RPC connectivity + latency
 *
 * Each check reports OK/FAIL with actionable fix instructions.
 */

import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import type { CliContext } from "../context.js";
import { withTimeout } from "../context.js";
import { outputSuccess, VERSION } from "../output.js";
import type { RequestContext } from "../output.js";

interface Check {
  name: string;
  value: string;
  status: "OK" | "FAIL";
  detail?: string;
}

export async function doctor(
  ctx: CliContext,
  flags: { human?: boolean },
  reqCtx: RequestContext,
): Promise<void> {
  const checks: Check[] = [];

  // 1. Version
  checks.push({ name: "version", value: VERSION, status: "OK" });

  // 2. Network
  checks.push({ name: "network", value: ctx.network, status: "OK" });

  // 3. Wallet
  if (ctx.signer) {
    const address = ctx.signer.toSuiAddress();
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    checks.push({ name: "wallet", value: short, status: "OK", detail: "key detected" });
  } else if (process.env.SUI_PRIVATE_KEY) {
    checks.push({
      name: "wallet",
      value: "SUI_PRIVATE_KEY",
      status: "FAIL",
      detail: "Key is set but could not be decoded. Check format: suiprivkey1... (bech32) or base64.",
    });
  } else {
    checks.push({
      name: "wallet",
      value: "SUI_PRIVATE_KEY",
      status: "FAIL",
      detail: "Not set. Export SUI_PRIVATE_KEY=suiprivkey1... to enable transactions.",
    });
  }

  // 4. Package ID
  const packageId = ctx.config.packageId;
  const isDefault = !process.env.SUI_PACKAGE_ID;
  const short = `${packageId.slice(0, 6)}...${packageId.slice(-4)}`;
  checks.push({
    name: "package ID",
    value: short,
    status: "OK",
    detail: isDefault ? `using default for ${ctx.network}` : "custom override via SUI_PACKAGE_ID",
  });

  // 5. RPC connectivity
  const rpcUrl = process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(ctx.network);
  try {
    const start = performance.now();
    await withTimeout(ctx, ctx.suiClient.getRpcApiVersion(), "RPC version check");
    const latency = Math.round(performance.now() - start);
    checks.push({
      name: "RPC connectivity",
      value: `${latency}ms`,
      status: "OK",
      detail: rpcUrl.length > 40 ? `${rpcUrl.slice(0, 37)}...` : rpcUrl,
    });
  } catch (e) {
    checks.push({
      name: "RPC connectivity",
      value: "unreachable",
      status: "FAIL",
      detail: `Could not connect to ${rpcUrl}. ${e instanceof Error ? e.message : ""}`.trim(),
    });
  }

  const allOk = checks.every((c) => c.status === "OK");

  outputSuccess("doctor", {
    healthy: allOk,
    checks,
  }, flags.human ?? false, reqCtx);
}
