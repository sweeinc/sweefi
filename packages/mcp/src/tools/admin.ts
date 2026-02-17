import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAdminPauseTx, buildAdminUnpauseTx, buildBurnAdminCapTx } from "@sweepay/sui/ptb";
import type { SweepayContext } from "../context.js";
import { requireSigner } from "../context.js";
import { assertTxSuccess, suiObjectId } from "../utils/format.js";

export function registerAdminTools(server: McpServer, ctx: SweepayContext) {
  // ─── Read-only: check protocol status ───
  server.registerTool(
    "sweepay_protocol_status",
    {
      title: "Check Protocol Status",
      description:
        "Check whether the SweePay protocol is paused or active. " +
        "When paused, new stream/escrow creation is blocked but existing " +
        "operations (claim, release, refund) continue normally. " +
        "No wallet required.",
      inputSchema: {},
    },
    async () => {
      if (!ctx.config.protocolStateId) {
        return {
          content: [{
            type: "text" as const,
            text: "ProtocolState object ID not configured. Set SUI_PROTOCOL_STATE_ID or pass protocolStateId in config.",
          }],
        };
      }

      const obj = await ctx.suiClient.getObject({
        id: ctx.config.protocolStateId,
        options: { showContent: true },
      });

      if (!obj.data?.content || obj.data.content.dataType !== "moveObject") {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to fetch ProtocolState (${ctx.config.protocolStateId}). Object may not exist on ${ctx.network}.`,
          }],
        };
      }

      const fields = obj.data.content.fields as Record<string, unknown>;
      const paused = fields.paused as boolean;

      return {
        content: [{
          type: "text" as const,
          text: `Protocol Status: ${paused ? "PAUSED" : "ACTIVE"}\n` +
            `ProtocolState ID: ${ctx.config.protocolStateId}\n` +
            `Network: ${ctx.network}\n\n` +
            (paused
              ? "New stream/escrow creation is blocked. Existing streams and all withdrawals are unaffected."
              : "All operations are enabled."),
        }],
      };
    },
  );

  // ─── Transaction: pause protocol ───
  server.registerTool(
    "sweepay_pause_protocol",
    {
      title: "Pause Protocol",
      description:
        "Emergency pause — blocks new stream/escrow creation. " +
        "Existing streams, claims, releases, refunds, and payments are unaffected. " +
        "Requires AdminCap and configured wallet.",
      inputSchema: {
        adminCapId: suiObjectId("AdminCap"),
      },
    },
    async ({ adminCapId }) => {
      const signer = requireSigner(ctx);

      const tx = buildAdminPauseTx(ctx.config, {
        adminCapId,
        sender: signer.toSuiAddress(),
      });

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [{
          type: "text" as const,
          text: `Protocol PAUSED successfully.\n\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nNew stream/escrow creation is now blocked. Use sweepay_unpause_protocol to resume.`,
        }],
      };
    },
  );

  // ─── Transaction: unpause protocol ───
  server.registerTool(
    "sweepay_unpause_protocol",
    {
      title: "Unpause Protocol",
      description:
        "Resume normal protocol operation after an emergency pause. " +
        "Re-enables stream/escrow creation. " +
        "Requires AdminCap and configured wallet.",
      inputSchema: {
        adminCapId: suiObjectId("AdminCap"),
      },
    },
    async ({ adminCapId }) => {
      const signer = requireSigner(ctx);

      const tx = buildAdminUnpauseTx(ctx.config, {
        adminCapId,
        sender: signer.toSuiAddress(),
      });

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [{
          type: "text" as const,
          text: `Protocol UNPAUSED successfully.\n\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nAll operations are now enabled.`,
        }],
      };
    },
  );

  // ─── Transaction: burn admin cap ───
  server.registerTool(
    "sweepay_burn_admin_cap",
    {
      title: "Burn Admin Cap (IRREVERSIBLE)",
      description:
        "Irrevocably burn the AdminCap — protocol becomes fully trustless. " +
        "After burn, NO ONE can pause or unpause the protocol. This is a one-way door. " +
        "Only use when the protocol is mature and you want to remove all admin power. " +
        "Requires AdminCap and configured wallet.",
      inputSchema: {
        adminCapId: suiObjectId("AdminCap (IRREVERSIBLE)"),
      },
    },
    async ({ adminCapId }) => {
      const signer = requireSigner(ctx);

      const tx = buildBurnAdminCapTx(ctx.config, {
        adminCapId,
        sender: signer.toSuiAddress(),
      });

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [{
          type: "text" as const,
          text: `AdminCap BURNED. This is irreversible.\n\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nThe protocol is now fully trustless — no one can pause or unpause it.`,
        }],
      };
    },
  );
}
