import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@sweepay/core/types";
import type { FacilitatorSuiSigner } from "../../signer";

/**
 * Sui facilitator implementation for the Prepaid payment scheme (x402-compat layer).
 *
 * Verifies signed deposit transactions via simulation and broadcasts them during settlement.
 * The deposit creates a PrepaidBalance shared object that the provider can claim against.
 *
 * Prepaid-specific verification:
 *   - Payload must include ratePerCall and optionally maxCalls
 *   - These must match the requirements (prevents rate manipulation)
 *   - Deposit amount must meet the minDeposit threshold
 */
export class PrepaidSuiScheme implements SchemeNetworkFacilitator {
  readonly scheme = "prepaid";
  readonly caipFamily = "sui:*";

  constructor(private readonly signer: FacilitatorSuiSigner) {}

  getExtra(_: string): Record<string, unknown> | undefined {
    return undefined;
  }

  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Step 0: Validate scheme
    if (payload.accepted.scheme !== "prepaid" || requirements.scheme !== "prepaid") {
      return {
        isValid: false,
        invalidReason: "unsupported_scheme",
        payer: undefined,
      };
    }

    // Step 1: Network match
    if (payload.accepted.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: "network_mismatch",
        payer: undefined,
      };
    }

    const prepaidPayload = payload.payload as unknown as PrepaidPayloadShape;

    // Validate payload structure
    if (!prepaidPayload?.transaction || !prepaidPayload?.signature) {
      return {
        isValid: false,
        invalidReason: "invalid_prepaid_payload_missing_transaction_or_signature",
        payer: undefined,
      };
    }

    // Validate rate commitment matches requirements
    const reqExtra = requirements.extra as unknown as PrepaidRequirementsExtra | undefined;
    if (reqExtra?.ratePerCall && prepaidPayload.ratePerCall !== reqExtra.ratePerCall) {
      return {
        isValid: false,
        invalidReason: "invalid_prepaid_payload_rate_mismatch",
        payer: undefined,
      };
    }

    if (reqExtra?.maxCalls && prepaidPayload.maxCalls !== reqExtra.maxCalls) {
      return {
        isValid: false,
        invalidReason: "invalid_prepaid_payload_max_calls_mismatch",
        payer: undefined,
      };
    }

    let payer: string;
    try {
      // Run signature verification + dry-run simulation in parallel
      const [recoveredPayer, dryRunResult] = await Promise.all([
        this.signer.verifySignature(
          prepaidPayload.transaction,
          prepaidPayload.signature,
          requirements.network,
        ),
        this.signer.simulateTransaction(prepaidPayload.transaction, requirements.network),
      ]);

      payer = recoveredPayer;

      // Check simulation status
      if (dryRunResult.effects?.status?.status !== "success") {
        return {
          isValid: false,
          invalidReason: "invalid_prepaid_payload_transaction_dry_run_failed",
          invalidMessage: dryRunResult.effects?.status?.error || "Simulation failed",
          payer,
        };
      }

      // Verify deposit amount meets minimum (from balance changes)
      if (reqExtra?.minDeposit) {
        const balanceChanges = dryRunResult.balanceChanges ?? [];
        const payerChange = balanceChanges.find(
          bc =>
            this.extractAddress(bc.owner) === payer &&
            BigInt(bc.amount) < 0n,
        );

        if (payerChange) {
          const depositedAmount = -BigInt(payerChange.amount);
          const minDeposit = BigInt(reqExtra.minDeposit);
          if (depositedAmount < minDeposit) {
            return {
              isValid: false,
              invalidReason: "invalid_prepaid_payload_deposit_below_minimum",
              payer,
            };
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("Signature verification failed") ||
        errorMessage.includes("Invalid signature")
      ) {
        return {
          isValid: false,
          invalidReason: "invalid_prepaid_payload_signature_verification_failed",
          invalidMessage: errorMessage,
          payer: undefined,
        };
      }

      return {
        isValid: false,
        invalidReason: "transaction_simulation_failed",
        invalidMessage: errorMessage,
        payer: undefined,
      };
    }

    return {
      isValid: true,
      invalidReason: undefined,
      payer,
    };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    // Defense-in-depth: re-verify before broadcasting
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: "",
        errorReason: verification.invalidReason ?? "verification_failed",
        payer: verification.payer,
      };
    }

    const prepaidPayload = payload.payload as unknown as PrepaidPayloadShape;

    try {
      const digest = await this.signer.executeTransaction(
        prepaidPayload.transaction,
        prepaidPayload.signature,
        requirements.network,
      );

      await this.signer.waitForTransaction(digest, requirements.network);

      return {
        success: true,
        transaction: digest,
        network: payload.accepted.network,
        payer: verification.payer,
      };
    } catch (error) {
      return {
        success: false,
        errorReason: "transaction_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        transaction: "",
        network: payload.accepted.network,
        payer: verification.payer,
      };
    }
  }

  private extractAddress(owner: unknown): string {
    if (typeof owner === "string") return "";
    if (owner && typeof owner === "object") {
      if ("AddressOwner" in owner) return (owner as { AddressOwner: string }).AddressOwner;
    }
    return "";
  }
}

/** Shape of the prepaid payload sent by clients */
interface PrepaidPayloadShape {
  transaction: string;
  signature: string;
  ratePerCall?: string;
  maxCalls?: string;
}

/** Prepaid-specific fields in requirements.extra */
interface PrepaidRequirementsExtra {
  ratePerCall?: string;
  maxCalls?: string;
  minDeposit?: string;
  withdrawalDelayMs?: string;
}
