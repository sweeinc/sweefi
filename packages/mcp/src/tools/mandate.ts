import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SuiObjectChange } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { MandateContract, AgentMandateContract, createBuilderConfig } from "@sweefi/sui";
import type { SweefiContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, parseAmountOrZero, assertTxSuccess, ZERO_ADDRESS, suiAddress, suiObjectId, optionalSuiAddress } from "../utils/format.js";

const LEVEL_NAMES: Record<number, string> = {
  0: "L0 (Read-only)",
  1: "L1 (Monitor)",
  2: "L2 (Capped)",
  3: "L3 (Autonomous)",
};

export function registerMandateTools(server: McpServer, ctx: SweefiContext) {
  const builderConfig = createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  });
  const mandate = new MandateContract(builderConfig);
  const agentMandate = new AgentMandateContract(builderConfig);
  // ── Create Registry ──────────────────────────────────────────
  server.registerTool(
    "sweefi_create_registry",
    {
      title: "Create Revocation Registry",
      description:
        "Create a revocation registry for mandate management. Each delegator (human) needs " +
        "one registry — a shared object used to check whether mandates have been revoked. " +
        "Create this BEFORE creating any mandates. The registry ID is required for " +
        "sweefi_basic_mandated_pay, sweefi_agent_mandated_pay, and sweefi_revoke_mandate. " +
        "Requires a configured wallet.",
      inputSchema: {},
    },
    async () => {
      const signer = requireSigner(ctx);

      const tx = new Transaction();
      mandate.createRegistry({
        sender: signer.toSuiAddress(),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);

      const registryObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("RevocationRegistry"),
      );
      const registryId = registryObj && "objectId" in registryObj ? registryObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Revocation registry created!\n\n` +
              `Registry ID: ${registryId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Save this Registry ID — you need it when creating mandated payments and revoking mandates.`,
          },
        ],
      };
    },
  );

  // ── Create Mandate (Basic) ───────────────────────────────────
  server.registerTool(
    "sweefi_create_mandate",
    {
      title: "Create Spending Mandate",
      description:
        "Create a basic spending mandate authorizing an agent to pay on your behalf. " +
        "The mandate has a per-transaction limit, lifetime cap, and expiry. " +
        "The agent receives the mandate object and can use it with sweefi_basic_mandated_pay. " +
        "For tiered autonomy with daily/weekly caps, use sweefi_create_agent_mandate instead. " +
        "Requires a configured wallet (you are the delegator/human).",
      inputSchema: {
        delegate: suiAddress("Agent/delegate"),
        maxPerTx: z.string().describe("Maximum amount per transaction in base units"),
        maxTotal: z.string().describe("Lifetime spending cap in base units"),
        expiresAtMs: z
          .string()
          .describe("Expiry as Unix timestamp in milliseconds"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ delegate, maxPerTx, maxTotal, expiresAtMs, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      mandate.create({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        delegate,
        maxPerTx: parseAmount(maxPerTx, "maxPerTx"),
        maxTotal: parseAmount(maxTotal, "maxTotal"),
        expiresAtMs: parseAmount(expiresAtMs, "expiresAtMs"),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);

      const mandateObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("Mandate") && !c.objectType?.includes("AgentMandate"),
      );
      const mandateId = mandateObj && "objectId" in mandateObj ? mandateObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Mandate created!\n\n` +
              `Mandate ID: ${mandateId}\n` +
              `Delegate: ${delegate}\n` +
              `Max per TX: ${formatBalance(maxPerTx, resolvedType)}\n` +
              `Lifetime cap: ${formatBalance(maxTotal, resolvedType)}\n` +
              `Expires: ${new Date(Number(expiresAtMs)).toISOString()}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `The agent can now use sweefi_basic_mandated_pay to spend within these limits.`,
          },
        ],
      };
    },
  );

  // ── Create Agent Mandate (Tiered) ────────────────────────────
  server.registerTool(
    "sweefi_create_agent_mandate",
    {
      title: "Create Agent Mandate (Tiered)",
      description:
        "Create a tiered agent mandate with progressive autonomy levels (L0-L3) and " +
        "daily/weekly spending caps. This is the recommended mandate type for AI agents. " +
        "Levels: L0 (read-only), L1 (monitor), L2 (capped purchasing), L3 (autonomous). " +
        "Only L2+ can spend. Daily/weekly limits reset automatically (lazy reset on first spend " +
        "after period boundary). Cannot downgrade levels — revoke and recreate instead. " +
        "Requires a configured wallet (you are the delegator/human).",
      inputSchema: {
        delegate: suiAddress("Agent/delegate"),
        level: z
          .number()
          .int()
          .min(0)
          .max(3)
          .describe("Autonomy level: 0=L0(read-only), 1=L1(monitor), 2=L2(capped), 3=L3(autonomous)"),
        maxPerTx: z.string().describe("Maximum amount per transaction in base units"),
        dailyLimit: z
          .string()
          .describe("Daily spending cap in base units. Use '0' for no daily limit."),
        weeklyLimit: z
          .string()
          .describe("Weekly spending cap in base units. Use '0' for no weekly limit."),
        maxTotal: z.string().describe("Lifetime spending cap in base units"),
        expiresAtMs: z
          .string()
          .describe("Expiry as Unix timestamp in milliseconds"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ delegate, level, maxPerTx, dailyLimit, weeklyLimit, maxTotal, expiresAtMs, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      agentMandate.create({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        delegate,
        level: level as 0 | 1 | 2 | 3,
        maxPerTx: parseAmount(maxPerTx, "maxPerTx"),
        dailyLimit: parseAmountOrZero(dailyLimit, "dailyLimit"),
        weeklyLimit: parseAmountOrZero(weeklyLimit, "weeklyLimit"),
        maxTotal: parseAmount(maxTotal, "maxTotal"),
        expiresAtMs: parseAmount(expiresAtMs, "expiresAtMs"),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);

      const mandateObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("AgentMandate"),
      );
      const mandateId = mandateObj && "objectId" in mandateObj ? mandateObj.objectId : "unknown";
      const levelName = LEVEL_NAMES[level] ?? `L${level}`;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Agent mandate created!\n\n` +
              `Mandate ID: ${mandateId}\n` +
              `Delegate: ${delegate}\n` +
              `Level: ${levelName}\n` +
              `Max per TX: ${formatBalance(maxPerTx, resolvedType)}\n` +
              `Daily limit: ${formatBalance(dailyLimit, resolvedType)}\n` +
              `Weekly limit: ${formatBalance(weeklyLimit, resolvedType)}\n` +
              `Lifetime cap: ${formatBalance(maxTotal, resolvedType)}\n` +
              `Expires: ${new Date(Number(expiresAtMs)).toISOString()}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `The agent can now use sweefi_agent_mandated_pay to spend within these limits.`,
          },
        ],
      };
    },
  );

  // ── Basic Mandated Pay ─────────────────────────────────────
  server.registerTool(
    "sweefi_basic_mandated_pay",
    {
      title: "Pay Using Basic Mandate",
      description:
        "Make a payment using a basic mandate (created with sweefi_create_mandate). " +
        "The mandate's per-tx and lifetime caps are checked atomically with the payment. " +
        "Every mandated payment checks the revocation registry — if revoked, the transaction fails. " +
        "For agent mandates (with daily/weekly caps), use sweefi_agent_mandated_pay instead. " +
        "Requires a configured wallet (must be the delegate/agent who owns the mandate).",
      inputSchema: {
        mandateId: suiObjectId("Mandate"),
        registryId: suiObjectId("RevocationRegistry"),
        recipient: suiAddress("Payment recipient"),
        amount: z.string().describe("Payment amount in base units"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
        memo: z.string().optional().describe("Optional payment memo"),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Default 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ mandateId, registryId, recipient, amount, coinType, memo, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const payAmount = parseAmount(amount);

      checkSpendingLimit(ctx, payAmount);

      const tx = new Transaction();
      mandate.mandatedPay({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        recipient,
        amount: payAmount,
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
        memo,
        mandateId,
        registryId,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, payAmount);

      const formatted = formatBalance(amount, resolvedType);
      const receiptObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("PaymentReceipt"),
      );
      const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Mandated payment successful!\n\n` +
              `Amount: ${formatted}\n` +
              `Recipient: ${recipient}\n` +
              `Mandate: ${mandateId} (basic)\n` +
              `Receipt ID: ${receiptId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Mandate limits were checked and debited atomically with the payment.`,
          },
        ],
      };
    },
  );

  // ── Agent Mandated Pay ─────────────────────────────────────
  server.registerTool(
    "sweefi_agent_mandated_pay",
    {
      title: "Pay Using Agent Mandate",
      description:
        "Make a payment using an agent mandate (created with sweefi_create_agent_mandate). " +
        "Checks per-tx, daily, weekly, and lifetime caps atomically with the payment. " +
        "Daily/weekly counters use lazy reset — they reset on the first spend after the period boundary. " +
        "Every mandated payment checks the revocation registry — if revoked, the transaction fails. " +
        "For basic mandates (per-tx + lifetime only), use sweefi_basic_mandated_pay instead. " +
        "Requires a configured wallet (must be the delegate/agent who owns the mandate).",
      inputSchema: {
        mandateId: suiObjectId("AgentMandate"),
        registryId: suiObjectId("RevocationRegistry"),
        recipient: suiAddress("Payment recipient"),
        amount: z.string().describe("Payment amount in base units"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
        memo: z.string().optional().describe("Optional payment memo"),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Default 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ mandateId, registryId, recipient, amount, coinType, memo, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const payAmount = parseAmount(amount);

      checkSpendingLimit(ctx, payAmount);

      const tx = new Transaction();
      agentMandate.pay({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        recipient,
        amount: payAmount,
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
        memo,
        mandateId,
        registryId,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, payAmount);

      const formatted = formatBalance(amount, resolvedType);
      const receiptObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("PaymentReceipt"),
      );
      const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Mandated payment successful!\n\n` +
              `Amount: ${formatted}\n` +
              `Recipient: ${recipient}\n` +
              `Mandate: ${mandateId} (agent)\n` +
              `Receipt ID: ${receiptId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Mandate limits (per-tx, daily, weekly, lifetime) were checked and debited atomically.`,
          },
        ],
      };
    },
  );

  // ── Revoke Mandate ───────────────────────────────────────────
  server.registerTool(
    "sweefi_revoke_mandate",
    {
      title: "Revoke Mandate",
      description:
        "Instantly revoke a mandate, preventing the agent from making any further payments. " +
        "Adds the mandate ID to the revocation registry. Works for both basic and agent mandates " +
        "(they share the same revocation registry). " +
        "The agent's next sweefi_basic_mandated_pay or sweefi_agent_mandated_pay will fail with MANDATE_REVOKED. " +
        "Requires a configured wallet (must be the delegator who owns the registry).",
      inputSchema: {
        registryId: suiObjectId("RevocationRegistry"),
        mandateId: suiObjectId("Mandate to revoke"),
        coinType: z.string().optional().describe('Token type of the mandate. Defaults to "SUI".'),
      },
    },
    async ({ registryId, mandateId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      mandate.revoke({
        sender: signer.toSuiAddress(),
        registryId,
        mandateId,
        coinType: resolvedType,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Mandate revoked!\n\n` +
              `Mandate: ${mandateId}\n` +
              `Registry: ${registryId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `The agent can no longer use this mandate for payments. ` +
              `Revocation is immediate and permanent.`,
          },
        ],
      };
    },
  );

  // ── Inspect Mandate (read-only) ──────────────────────────────
  server.registerTool(
    "sweefi_inspect_mandate",
    {
      title: "Inspect Mandate",
      description:
        "Read-only: Fetch the on-chain state of a mandate (basic or agent). Shows delegator, " +
        "delegate, spending limits, amount spent, expiry, and (for agent mandates) the autonomy " +
        "level and daily/weekly caps. " +
        "Does NOT require a wallet.",
      inputSchema: {
        mandateId: suiObjectId("Mandate"),
      },
    },
    async ({ mandateId }) => {
      const obj = await ctx.suiClient.getObject({
        id: mandateId,
        options: { showContent: true, showType: true },
      });

      if (!obj.data?.content || obj.data.content.dataType !== "moveObject") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Mandate not found: ${mandateId}\n\nThe object may have been destroyed.`,
            },
          ],
        };
      }

      const fields = obj.data.content.fields as Record<string, any>;
      const objectType = obj.data.content.type ?? "";
      const isAgent = objectType.includes("AgentMandate");

      const delegator = fields.delegator ?? "unknown";
      const delegate = fields.delegate ?? "unknown";
      const maxPerTx = fields.max_per_tx ?? "unknown";
      const maxTotal = fields.max_total ?? "unknown";
      const totalSpent = fields.total_spent ?? "0";
      const expiresAtMs = fields.expires_at_ms ?? "0";

      let remaining: string;
      try {
        remaining = `${BigInt(maxTotal) - BigInt(totalSpent)} base units`;
      } catch {
        remaining = "unknown";
      }

      let details =
        `Mandate Status\n\n` +
        `Mandate ID: ${mandateId}\n` +
        `Type: ${isAgent ? "Agent Mandate" : "Basic Mandate"}\n` +
        `Delegator: ${delegator}\n` +
        `Delegate: ${delegate}\n` +
        `Max per TX: ${maxPerTx} base units\n` +
        `Lifetime cap: ${maxTotal} base units\n` +
        `Total spent: ${totalSpent} base units\n` +
        `Remaining: ${remaining}\n` +
        `Expires: ${new Date(Number(expiresAtMs)).toISOString()}\n`;

      if (isAgent) {
        const level = fields.level ?? "unknown";
        const levelName = LEVEL_NAMES[Number(level)] ?? `L${level}`;
        const dailyLimit = fields.daily_limit ?? "0";
        const dailySpent = fields.daily_spent ?? "0";
        const weeklyLimit = fields.weekly_limit ?? "0";
        const weeklySpent = fields.weekly_spent ?? "0";

        details +=
          `\nAgent Mandate Details:\n` +
          `Level: ${levelName}\n` +
          `Daily limit: ${dailyLimit} base units\n` +
          `Daily spent: ${dailySpent} base units\n` +
          `Weekly limit: ${weeklyLimit} base units\n` +
          `Weekly spent: ${weeklySpent} base units\n`;
      }

      details += `\nNetwork: ${ctx.network}`;

      return {
        content: [
          {
            type: "text" as const,
            text: details,
          },
        ],
      };
    },
  );
}
