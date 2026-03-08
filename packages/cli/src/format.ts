/**
 * Human-friendly output formatting — colors, symbols, grouped sections.
 *
 * Design:
 *   - Uses node:util.styleText (Node 22+) for ANSI colors
 *   - Automatically respects NO_COLOR and FORCE_COLOR env vars
 *   - Unicode symbols (✓ ✗ ●) — consistent width, works everywhere
 *   - No external dependencies
 *
 * Architecture:
 *   - formatHumanSuccess() dispatches to per-command formatters
 *   - formatHumanError() renders structured errors as readable text
 *   - Each formatter groups related fields with visual hierarchy
 */

import { styleText } from "node:util";

// ── Symbols ──────────────────────────────────────────────────────────

const SYM = {
  ok: "✓",
  fail: "✗",
  bullet: "●",
  arrow: "→",
} as const;

// ── Color helpers ────────────────────────────────────────────────────

function green(s: string): string { return styleText("green", s); }
function red(s: string): string { return styleText("red", s); }
function dim(s: string): string { return styleText("dim", s); }
function bold(s: string): string { return styleText("bold", s); }
function cyan(s: string): string { return styleText("cyan", s); }
function yellow(s: string): string { return styleText("yellow", s); }

// ── Layout helpers ───────────────────────────────────────────────────

/** Render aligned key-value pairs with consistent label width. */
function kvBlock(pairs: [string, string | undefined][], indent = 2): string {
  const filtered = pairs.filter((p): p is [string, string] => p[1] !== undefined);
  if (filtered.length === 0) return "";
  const maxKey = Math.max(...filtered.map(([k]) => k.length));
  return filtered
    .map(([k, v]) => `${" ".repeat(indent)}${dim(k.padEnd(maxKey + 2))}${v}`)
    .join("\n");
}

/** Render a section of key-value pairs with a blank line separator. */
function section(pairs: [string, string | undefined][]): string {
  const block = kvBlock(pairs);
  if (!block) return "";
  return `\n${block}`;
}

/** Shorten a hex address/ID for display: 0xabcd...ef12 */
function shortHex(hex: string, prefixLen = 6, suffixLen = 4): string {
  if (hex.length <= prefixLen + suffixLen + 3) return hex;
  return `${hex.slice(0, prefixLen)}...${hex.slice(-suffixLen)}`;
}

// ── Success formatters ───────────────────────────────────────────────

export function formatHumanSuccess(command: string, data: Record<string, unknown>): string {
  // Dispatch to command-specific formatter if available
  const formatter = COMMAND_FORMATTERS[command];
  if (formatter) return formatter(data);

  // Fallback: generic grouped format
  return formatGenericSuccess(command, data);
}

function formatGenericSuccess(command: string, data: Record<string, unknown>): string {
  const lines: string[] = [`\n${green(SYM.ok)} ${bold(command)}\n`];
  const pairs = flattenToPairs(data);
  lines.push(kvBlock(pairs));
  return lines.join("\n") + "\n";
}

/** Pay command — the most important, demo-critical formatter. */
function formatPay(data: Record<string, unknown>): string {
  if (data.idempotent) {
    return [
      `\n${yellow(SYM.bullet)} ${bold("Payment Already Exists")} ${dim("(idempotent)")}`,
      section([
        ["Receipt", data.receiptId as string],
        ["Transaction", data.txDigest as string],
        ["Amount", data.amountFormatted as string],
        ["Recipient", data.recipient as string],
      ]),
      "",
      `  ${dim(data.message as string)}`,
      "",
    ].join("\n");
  }

  if (data.dryRun) {
    const affordable = data.affordable as boolean;
    const status = affordable ? green("affordable") : red("insufficient funds");
    const balance = data.currentBalance as Record<string, string> | undefined;
    const shortfall = data.shortfall as Record<string, string> | null;
    return [
      `\n${cyan(SYM.bullet)} ${bold("Dry Run")} ${dim("(no transaction)")}`,
      section([
        ["Recipient", data.recipient as string],
        ["Amount", data.amountFormatted as string],
        ["Coin", data.coin as string],
        ...(data.mandateId ? [["Mandate", data.mandateId as string] as [string, string]] : []),
        ["Gas (est)", data.estimatedGasMist !== undefined ? `${data.estimatedGasMist} MIST` : undefined],
        ["Affordable", status],
        ...(balance ? Object.entries(balance).map(([k, v]) => [`Balance (${k})`, v] as [string, string]) : []),
        ...(shortfall ? Object.entries(shortfall).map(([k, v]) => [`Shortfall (${k})`, red(v)] as [string, string]) : []),
      ]),
      `\n  ${dim(`Network: ${data.network}`)}`,
      "",
    ].join("\n");
  }

  return [
    `\n${green(SYM.ok)} ${bold("Payment Confirmed")}`,
    section([
      ["Transaction", data.txDigest as string],
      ["Amount", data.amountFormatted as string],
      ["Recipient", data.recipient as string],
      ...(data.mandateId ? [["Mandate", data.mandateId as string] as [string, string]] : []),
    ]),
    section([
      ["Gas", data.gasCostSui ? `${data.gasCostSui} SUI` : undefined],
      ...(data.idempotencyKey ? [["Idempotency", data.idempotencyKey as string] as [string, string]] : []),
      ["Receipt", data.receiptId as string | undefined],
      ["Network", data.network as string],
    ]),
    data.explorerUrl ? `\n  ${dim("Explorer")}  ${cyan(data.explorerUrl as string)}` : "",
    "",
  ].join("\n");
}

/** Pay-402 — HTTP 402 auto-payment flow. */
function formatPay402(data: Record<string, unknown>): string {
  if (data.idempotent) {
    const payment = data.payment as Record<string, unknown> | undefined;
    return [
      `\n${yellow(SYM.bullet)} ${bold("Payment Already Exists")} ${dim("(idempotent)")}`,
      section([
        ["URL", data.url as string],
        ["Receipt", payment?.receiptId as string | undefined],
        ["Transaction", payment?.txDigest as string | undefined],
      ]),
      "",
      `  ${dim(data.message as string)}`,
      "",
    ].join("\n");
  }

  if (!data.paymentRequired) {
    return [
      `\n${green(SYM.ok)} ${bold("No Payment Required")}`,
      section([
        ["URL", data.url as string],
        ["HTTP Status", String(data.httpStatus)],
      ]),
      data.body ? `\n  ${dim("Response")}  ${truncate(data.body as string, 200)}` : "",
      "",
    ].join("\n");
  }

  if (data.dryRun) {
    const req = data.requirements as Record<string, unknown> | undefined;
    return [
      `\n${cyan(SYM.bullet)} ${bold("Dry Run")} ${dim("(402 detected, no payment)")}`,
      section([
        ["URL", data.url as string],
        ["Protocol", data.protocol as string],
        ...(req ? Object.entries(req).map(([k, v]) => [k, String(v)] as [string, string]) : []),
      ]),
      `\n  ${dim(`Network: ${data.network}`)}`,
      "",
    ].join("\n");
  }

  const payment = data.payment as Record<string, unknown> | undefined;
  return [
    `\n${green(SYM.ok)} ${bold("402 Payment Complete")}`,
    section([
      ["URL", data.url as string],
      ["HTTP Status", String(data.httpStatus)],
      ["Protocol", data.protocol as string],
    ]),
    ...(payment ? [section([
      ["Transaction", payment.txDigest as string | undefined],
      ["Amount", payment.amountPaidFormatted as string | undefined],
      ["Gas", payment.gasCostSui ? `${payment.gasCostSui} SUI` : undefined],
      ["Scheme", payment.scheme as string | undefined],
      ["Receipt", payment.receiptId as string | undefined],
    ])] : []),
    data.explorerUrl ? `\n  ${dim("Explorer")}  ${cyan(data.explorerUrl as string)}` : "",
    data.body ? `\n  ${dim("Response")}  ${truncate(data.body as string, 200)}` : "",
    "",
  ].join("\n");
}

/** Balance — wallet info. */
function formatBalance(data: Record<string, unknown>): string {
  return [
    `\n${green(SYM.ok)} ${bold("Balance")}`,
    section([
      ["Address", data.address as string | undefined],
      ["Balance", data.balanceFormatted ? bold(data.balanceFormatted as string) : undefined],
      ["Coin Objects", data.coinObjects !== undefined ? String(data.coinObjects) : undefined],
      ["Network", data.network as string | undefined],
    ]),
    "",
  ].join("\n");
}

/** Doctor — setup diagnostics. */
function formatDoctor(data: Record<string, unknown>): string {
  const checks = data.checks as Array<{ name: string; value: string; status: string; detail?: string }>;
  const healthy = data.healthy as boolean;

  const lines: string[] = [`\n${bold("sweefi doctor")}\n`];
  if (checks.length === 0) {
    lines.push(`  ${dim("No checks ran.")}\n`);
    return lines.join("\n");
  }
  const maxName = Math.max(...checks.map((c) => c.name.length));
  const maxValue = Math.max(...checks.map((c) => c.value.length));

  for (const check of checks) {
    const icon = check.status === "OK" ? green(SYM.ok) : red(SYM.fail);
    const detail = check.detail ? dim(` (${check.detail})`) : "";
    lines.push(`  ${icon} ${check.name.padEnd(maxName + 2)}${check.value.padEnd(maxValue + 2)}${detail}`);
  }

  lines.push("");
  lines.push(healthy
    ? `  ${green("All checks passed.")}`
    : `  ${red("Some checks failed.")} Fix the issues above and re-run.`,
  );
  lines.push("");
  return lines.join("\n");
}

/** Wallet generate — keypair output. */
function formatWalletGenerate(data: Record<string, unknown>): string {
  return [
    `\n${green(SYM.ok)} ${bold("Wallet Generated")}`,
    section([
      ["Address", data.address as string | undefined],
      ["Private Key", data.privateKey as string | undefined],
    ]),
    "",
    ...(data.setup ? [`  ${dim("Setup:")} ${cyan(data.setup as string)}`, ""] : []),
    `  ${yellow("Save the private key securely. It cannot be recovered.")}`,
    "",
  ].join("\n");
}

/** Receipt — on-chain receipt lookup. */
function formatReceipt(data: Record<string, unknown>): string {
  const fields = data.fields as Record<string, unknown> | undefined;
  return [
    `\n${green(SYM.ok)} ${bold("Payment Receipt")}`,
    section([
      ["Receipt ID", data.receiptId as string],
      ["Type", data.type as string],
      ["Network", data.network as string],
    ]),
    ...(fields && Object.keys(fields).length > 0 ? [section(Object.entries(fields).map(([k, v]) => [k, String(v)] as [string, string]))] : []),
    "",
  ].join("\n");
}

/** Prepaid deposit — new prepaid balance. */
function formatPrepaidDeposit(data: Record<string, unknown>): string {
  if (data.dryRun) {
    return [
      `\n${cyan(SYM.bullet)} ${bold("Dry Run")} ${dim("(prepaid deposit)")}`,
      section([
        ["Provider", data.provider as string],
        ["Amount", data.amountFormatted as string],
        ["Rate/Call", data.ratePerCall as string],
        ["Max Calls", data.maxCalls as string],
        ["Gas (est)", data.gasEstimate ? `${data.gasEstimate} SUI` : undefined],
      ]),
      `\n  ${dim(`Network: ${data.network}`)}`,
      "",
    ].join("\n");
  }

  return [
    `\n${green(SYM.ok)} ${bold("Prepaid Balance Created")}`,
    section([
      ["Transaction", data.txDigest as string],
      ["Balance ID", data.balanceId as string | undefined],
      ["Provider", data.provider as string],
      ["Amount", data.amountFormatted as string],
    ]),
    section([
      ["Rate/Call", data.effectiveCostPerCall as string],
      ["Max Calls", data.maxCalls as string],
      ["Gas", data.gasCostSui ? `${data.gasCostSui} SUI` : undefined],
      ["Network", data.network as string],
    ]),
    data.explorerUrl ? `\n  ${dim("Explorer")}  ${cyan(data.explorerUrl as string)}` : "",
    "",
  ].join("\n");
}

/** Prepaid status — balance lookup. */
function formatPrepaidStatus(data: Record<string, unknown>): string {
  const { balanceId, network, ...fields } = data;
  return [
    `\n${green(SYM.ok)} ${bold("Prepaid Balance")}`,
    section([
      ["Balance ID", balanceId as string],
      ["Network", network as string],
    ]),
    ...(Object.keys(fields).length > 0 ? [section(Object.entries(fields).map(([k, v]) => [k, String(v)] as [string, string]))] : []),
    "",
  ].join("\n");
}

/** Prepaid/mandate list — table of items. */
function formatList(data: Record<string, unknown>, itemKey: string, itemLabel: string): string {
  const items = data[itemKey] as Array<Record<string, unknown>> | undefined;
  const count = data.count as number;

  if (!items || count === 0) {
    return [
      `\n${dim(SYM.bullet)} ${bold(`No ${itemLabel} Found`)}`,
      data.message ? `\n  ${dim(data.message as string)}` : "",
      "",
    ].join("\n");
  }

  const lines: string[] = [`\n${green(SYM.ok)} ${bold(`${count} ${itemLabel}`)} ${dim(`(${data.address})`)}\n`];
  for (const item of items) {
    const rawId = (item.objectId as string) ?? "unknown";
    const id = shortHex(rawId);
    const fields = item.fields as Record<string, unknown> | undefined;
    lines.push(`  ${SYM.bullet} ${cyan(id)}`);
    if (fields) {
      const interesting = Object.entries(fields)
        .filter(([k]) => !["id", "type"].includes(k))
        .slice(0, 5);
      for (const [k, v] of interesting) {
        lines.push(`    ${dim(k)}: ${String(v)}`);
      }
    }
  }
  if (data.truncated) lines.push(`\n  ${yellow("(results truncated)")}`);
  lines.push("");
  return lines.join("\n");
}

/** Mandate create — new mandate. */
function formatMandateCreate(data: Record<string, unknown>): string {
  if (data.dryRun) {
    return [
      `\n${cyan(SYM.bullet)} ${bold("Dry Run")} ${dim("(mandate create)")}`,
      section([
        ["Agent", data.agent as string],
        ["Max/TX", data.maxPerTxFormatted as string],
        ["Max Total", data.maxTotalFormatted as string],
        ["Expires", data.expiresAt as string],
        ["Gas (est)", data.gasEstimate ? `${data.gasEstimate} SUI` : undefined],
      ]),
      `\n  ${dim(`Network: ${data.network}`)}`,
      "",
    ].join("\n");
  }

  return [
    `\n${green(SYM.ok)} ${bold("Mandate Created")}`,
    section([
      ["Transaction", data.txDigest as string],
      ["Mandate ID", data.mandateId as string | undefined],
      ["Agent", data.agent as string],
    ]),
    section([
      ["Max/TX", data.maxPerTxFormatted as string],
      ["Max Total", data.maxTotalFormatted as string],
      ["Expires", data.expiresAt as string],
      ["Gas", data.gasCostSui ? `${data.gasCostSui} SUI` : undefined],
      ["Network", data.network as string],
    ]),
    data.explorerUrl ? `\n  ${dim("Explorer")}  ${cyan(data.explorerUrl as string)}` : "",
    "",
  ].join("\n");
}

/** Mandate check — mandate status. */
function formatMandateCheck(data: Record<string, unknown>): string {
  const { mandateId, network, owner, expired, ...fields } = data;
  const expiredStatus = expired === true ? red("EXPIRED") : expired === false ? green("ACTIVE") : dim("unknown");
  return [
    `\n${expired ? red(SYM.fail) : green(SYM.ok)} ${bold("Mandate")} ${expiredStatus}`,
    section([
      ["Mandate ID", mandateId as string],
      ["Status", expiredStatus],
      ["Network", network as string],
    ]),
    ...(Object.keys(fields).length > 0 ? [section(Object.entries(fields).map(([k, v]) => [k, String(v)] as [string, string]))] : []),
    "",
  ].join("\n");
}

// ── Command formatter registry ───────────────────────────────────────

const COMMAND_FORMATTERS: Record<string, (data: Record<string, unknown>) => string> = {
  "pay": formatPay,
  "pay-402": formatPay402,
  "balance": formatBalance,
  "doctor": formatDoctor,
  "wallet generate": formatWalletGenerate,
  "receipt": formatReceipt,
  "prepaid deposit": formatPrepaidDeposit,
  "prepaid status": formatPrepaidStatus,
  "prepaid list": (d) => formatList(d, "balances", "Prepaid Balances"),
  "mandate create": formatMandateCreate,
  "mandate check": formatMandateCheck,
  "mandate list": (d) => formatList(d, "mandates", "Mandates"),
};

// ── Error formatter ──────────────────────────────────────────────────

export function formatHumanError(
  command: string,
  code: string,
  message: string,
  retryable: boolean,
  suggestedAction?: string,
  requiresHumanAction?: boolean,
): string {
  const lines: string[] = [
    `\n${red(SYM.fail)} ${bold(titleCase(command))} ${red(`[${code}]`)}`,
    "",
    `  ${message}`,
  ];

  if (suggestedAction) {
    lines.push("");
    lines.push(`  ${dim("Fix:")} ${suggestedAction}`);
  }

  const flags: string[] = [];
  if (retryable) flags.push(yellow("retryable"));
  if (requiresHumanAction) flags.push(red("requires human action"));
  if (flags.length > 0) {
    lines.push(`  ${dim(flags.join(" · "))}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ── Utilities ────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.split(/[\s-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

/** Flatten nested data into key-value pairs for generic display. */
function flattenToPairs(data: Record<string, unknown>, prefix = ""): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      entries.push([fullKey, `[${value.length} items]`]);
    } else if (typeof value === "object") {
      entries.push(...flattenToPairs(value as Record<string, unknown>, fullKey));
    } else {
      entries.push([fullKey, String(value)]);
    }
  }
  return entries;
}
