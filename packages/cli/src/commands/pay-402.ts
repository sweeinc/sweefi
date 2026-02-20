/**
 * sweefi pay-402 --url <URL> [--method GET|POST] [--body "..."] [--header "K: V"]
 *
 * The Trojan horse command. When an API responds with HTTP 402 Payment Required,
 * this command handles everything: reads the s402 headers, signs the payment,
 * retries the request, returns the API response. The agent doesn't think about
 * blockchains — it just handles a 402 like it would handle a 401.
 *
 * Two-pass flow for full transparency:
 *   1. Fetch the URL → capture 402 requirements (amount, scheme)
 *   2. Create payment via s402 client → retry with X-PAYMENT header
 *   3. Return both the API response AND what was paid
 */

import { createS402Client } from "@sweefi/sdk/client";
import { S402_HEADERS, decodePaymentRequired } from "@sweefi/sdk";
import type { CliContext } from "../context.js";
import { requireSigner, CliError } from "../context.js";
import { outputSuccess } from "../output.js";

export async function pay402(
  ctx: CliContext,
  _args: string[],
  flags: { url?: string; method?: string; body?: string; header?: string[]; human?: boolean },
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

  // Pass 1: probe the URL to see if it returns 402 + capture requirements
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let probeResponse: Response;
  try {
    probeResponse = await fetch(flags.url, {
      method,
      headers,
      body: flags.body,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new CliError("TIMEOUT", "Request timed out after 30 seconds", true, "Check the URL is reachable or try again");
    }
    throw new CliError("NETWORK_ERROR", `Failed to reach ${flags.url}: ${e instanceof Error ? e.message : String(e)}`, true, "Check the URL and your network connection");
  }
  clearTimeout(timeout);

  // Not a 402 — the resource is free or already authenticated
  if (probeResponse.status !== 402) {
    const body = await probeResponse.text();
    outputSuccess("pay-402", {
      url: flags.url,
      status: probeResponse.status,
      paymentRequired: false,
      body: body.length > 10_000 ? body.slice(0, 10_000) + "...(truncated)" : body,
      network: ctx.network,
    }, flags.human ?? false);
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

  // Pass 2: create s402 client and make paid fetch
  const s402 = createS402Client({
    wallet: signer,
    network: `sui:${ctx.network}`,
    packageId: ctx.config.packageId,
  });

  const paidController = new AbortController();
  const paidTimeout = setTimeout(() => paidController.abort(), 30_000);
  let paidResponse: Response;
  try {
    paidResponse = await s402.fetch(flags.url, {
      method,
      headers,
      body: flags.body,
      signal: paidController.signal,
    });
  } catch (e) {
    clearTimeout(paidTimeout);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new CliError("TIMEOUT", "Paid request timed out after 30 seconds", true, "The payment may have been submitted — check your balance");
    }
    throw new CliError("PAYMENT_FAILED", `Paid fetch failed: ${e instanceof Error ? e.message : String(e)}`, true, "Check the URL and try again");
  }
  clearTimeout(paidTimeout);

  const responseBody = await paidResponse.text();

  outputSuccess("pay-402", {
    url: flags.url,
    status: paidResponse.status,
    paymentRequired: true,
    protocol: "s402",
    requirements,
    body: responseBody.length > 10_000 ? responseBody.slice(0, 10_000) + "...(truncated)" : responseBody,
    network: ctx.network,
    timestampMs: Date.now(),
  }, flags.human ?? false);
}
