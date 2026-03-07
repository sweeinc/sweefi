/**
 * sweefi pay-402 --url <URL> [--method GET|POST] [--body "..."] [--header "K: V"] [--idempotency-key <UUID>]
 *
 * The Trojan horse command. When an API responds with HTTP 402 Payment Required,
 * this command handles everything: reads the s402 headers, signs the payment,
 * retries the request, returns the API response. The agent doesn't think about
 * blockchains — it just handles a 402 like it would handle a 401.
 *
 * Two-pass flow for full transparency:
 *   1. Fetch the URL -> capture 402 requirements (amount, scheme)
 *   2. Create payment via s402 client -> retry with X-PAYMENT header
 *   3. Return both the API response AND what was paid
 *
 * v0.3 additions:
 *   - --idempotency-key: crash-safe dedup via on-chain memo (REQUIRED in JSON mode)
 *   - Payment metadata (txDigest, receiptId, gas) in output
 *   - httpStatus field (renamed from status for clarity)
 */

import { createS402Client } from "@sweefi/sui";
import type { S402PaymentMetadata } from "@sweefi/sui";
import { S402_HEADERS, decodePaymentRequired } from "s402";
import type { CliContext } from "../context.js";
import { requireSigner, CliError, debug } from "../context.js";
import { outputSuccess, explorerUrl, formatBalance } from "../output.js";
import type { RequestContext } from "../output.js";
import { checkIdempotencyKey, buildIdempotencyMemo } from "../idempotency.js";

export interface Pay402Flags {
  url?: string;
  method?: string;
  body?: string;
  header?: string[];
  human?: boolean;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export async function pay402(
  ctx: CliContext,
  _args: string[],
  flags: Pay402Flags,
  reqCtx: RequestContext,
): Promise<void> {
  if (!flags.url) {
    throw new CliError("MISSING_ARGS", "Usage: sweefi pay-402 --url <URL>", false, "Example: sweefi pay-402 --url https://api.example.com/premium/data");
  }

  // Validate URL before making network requests
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(flags.url);
  } catch {
    throw new CliError("INVALID_URL", `Invalid URL: "${flags.url}"`, false, "Provide a full URL starting with https://");
  }
  if (!parsedUrl.protocol.startsWith("http")) {
    throw new CliError("INVALID_URL", `Unsupported URL scheme: "${parsedUrl.protocol}"`, false, "Only http:// and https:// URLs are supported");
  }

  // Require idempotency key in JSON mode (same contract as pay)
  if (!flags.human && !flags.idempotencyKey && !flags.dryRun) {
    throw new CliError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "pay-402 in JSON mode requires --idempotency-key to prevent double-spend on crash/retry",
      false,
      "Add --idempotency-key <UUID>. Example: sweefi pay-402 --url https://api.example.com --idempotency-key $(uuidgen)",
      false,
    );
  }

  const signer = requireSigner(ctx);
  const method = flags.method?.toUpperCase() ?? "GET";
  const headers = new Headers();
  if (flags.header) {
    for (const h of flags.header) {
      const [key, ...rest] = h.split(":");
      if (key && rest.length > 0) {
        headers.set(key.trim(), rest.join(":").trim());
      }
    }
  }

  // Idempotency check: look for existing receipt with this key before doing anything
  if (flags.idempotencyKey) {
    debug(ctx, "pay-402: checking idempotency key:", flags.idempotencyKey);
    const existing = await checkIdempotencyKey(
      ctx.suiClient,
      signer.toSuiAddress(),
      ctx.config.packageId,
      flags.idempotencyKey,
      "", // recipient unknown until 402 probe
      0n, // amount unknown until 402 probe
      true, // skipConflictCheck — pay-402 uses key-only matching (see D4 in v0.3 spec)
    );

    if (existing) {
      debug(ctx, "pay-402: existing receipt found, skipping payment");
      outputSuccess("pay-402", {
        idempotent: true,
        url: flags.url,
        payment: {
          receiptId: existing.receiptId,
          txDigest: existing.txDigest,
          memo: existing.memo,
        },
        message: "Payment already exists with this idempotency key. No new payment created. Re-fetch the URL directly if you need the content.",
        network: ctx.network,
      }, flags.human ?? false, reqCtx);
      return;
    }
  }

  // Pass 1: probe the URL to see if it returns 402 + capture requirements
  debug(ctx, "pay-402: probing", flags.url, "method:", method);
  const controller = new AbortController();
  const probeTimer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  let probeResponse: Response;
  try {
    probeResponse = await fetch(flags.url, {
      method,
      headers,
      body: flags.body,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(probeTimer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new CliError("TIMEOUT", `Request timed out after ${ctx.timeoutMs}ms`, true, "Increase --timeout or check the URL is reachable");
    }
    throw new CliError("NETWORK_ERROR", `Failed to reach ${flags.url}: ${e instanceof Error ? e.message : String(e)}`, true, "Check the URL and your network connection");
  }
  clearTimeout(probeTimer);

  // Not a 402 — the resource is free or already authenticated
  if (probeResponse.status !== 402) {
    const body = await probeResponse.text();
    outputSuccess("pay-402", {
      url: flags.url,
      httpStatus: probeResponse.status,
      paymentRequired: false,
      body: body.length > 10_000 ? body.slice(0, 10_000) + "...(truncated)" : body,
      network: ctx.network,
    }, flags.human ?? false, reqCtx);
    return;
  }

  // Check for s402 payment-required header
  const requirementsHeader = probeResponse.headers.get(S402_HEADERS.PAYMENT_REQUIRED);
  if (!requirementsHeader) {
    throw new CliError(
      "UNKNOWN_402",
      "Server returned 402 but no s402 payment headers found",
      false,
      "This 402 may not be a crypto-payable resource",
    );
  }

  // Extract requirements for reporting
  let requirements: Record<string, unknown> = {};
  try {
    requirements = decodePaymentRequired(requirementsHeader) as unknown as Record<string, unknown>;
  } catch {
    // Best-effort — proceed with payment even if we can't decode requirements
  }

  // Dry-run: show what would be paid without executing
  if (flags.dryRun) {
    outputSuccess("pay-402", {
      dryRun: true,
      url: flags.url,
      httpStatus: 402,
      paymentRequired: true,
      protocol: "s402",
      requirements,
      network: ctx.network,
    }, flags.human ?? false, reqCtx);
    return;
  }

  // Build memo for idempotency tracking
  const memo = flags.idempotencyKey
    ? buildIdempotencyMemo(flags.idempotencyKey)
    : undefined;

  // Pass 2: create s402 client and make paid fetch
  const s402 = createS402Client({
    wallet: signer,
    network: `sui:${ctx.network}`,
    packageId: ctx.config.packageId,
  });

  debug(ctx, "pay-402: making paid request via s402 client", memo ? `memo: ${memo}` : "");
  const paidController = new AbortController();
  const paidTimer = setTimeout(() => paidController.abort(), ctx.timeoutMs);
  let paidResponse: Response;
  try {
    paidResponse = await s402.fetch(flags.url, {
      method,
      headers,
      body: flags.body,
      signal: paidController.signal,
      ...(memo && { s402: { memo } }),
    });
  } catch (e) {
    clearTimeout(paidTimer);
    if (e instanceof DOMException && e.name === "AbortError") {
      // NOT retryable — the payment TX may already be on-chain. Retrying could double-spend.
      throw new CliError("TIMEOUT", `Paid request timed out after ${ctx.timeoutMs}ms`, false, "The payment may have been submitted — check your balance before retrying. Increase --timeout for slow endpoints.");
    }
    // PAYMENT_FAILED is also not safely retryable — the TX may have been signed and broadcast
    throw new CliError("PAYMENT_FAILED", `Paid fetch failed: ${e instanceof Error ? e.message : String(e)}`, false, "The payment may have been submitted — check your balance before retrying");
  }
  clearTimeout(paidTimer);

  const responseBody = await paidResponse.text();

  // Extract payment metadata from the s402 client's non-enumerable Response property
  const paymentMeta = (paidResponse as unknown as { s402?: S402PaymentMetadata }).s402;

  const data: Record<string, unknown> = {
    url: flags.url,
    httpStatus: paidResponse.status,
    paymentRequired: true,
    protocol: "s402",
    requirements,
    body: responseBody.length > 10_000 ? responseBody.slice(0, 10_000) + "...(truncated)" : responseBody,
    network: ctx.network,
    timestampMs: Date.now(),
  };

  // Add payment metadata if available from the s402 client's extended Response
  if (paymentMeta?.txDigest) {
    const coin = (requirements.asset as string) ?? "0x2::sui::SUI";
    data.payment = {
      txDigest: paymentMeta.txDigest,
      receiptId: paymentMeta.receiptId,
      amountPaid: paymentMeta.amount,
      amountPaidFormatted: paymentMeta.amount ? formatBalance(paymentMeta.amount, coin) : undefined,
      coin,
      gasCostSui: paymentMeta.gasCostMist ? (paymentMeta.gasCostMist / 1e9).toFixed(6) : undefined,
      scheme: paymentMeta.scheme,
    };
    data.explorerUrl = explorerUrl(ctx.network, paymentMeta.txDigest);
  }

  if (flags.idempotencyKey) {
    data.idempotencyKey = flags.idempotencyKey;
  }

  outputSuccess("pay-402", data, flags.human ?? false, reqCtx);
}
