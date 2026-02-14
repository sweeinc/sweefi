import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@sweepay/core/types";
import type { FacilitatorSuiSigner } from "../../signer";
import type { ExactSuiPayload } from "../../types";
import { coinTypesEqual } from "../../utils";

/**
 * Sui facilitator implementation for the Exact payment scheme.
 * Verifies signed transactions via simulation and broadcasts them during settlement.
 * Implements the sign-first model per the official Sui spec (scheme_exact_sui.md).
 */
export class ExactSuiScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "sui:*";

  /**
   * Creates a new ExactSuiScheme facilitator instance.
   *
   * @param signer - The facilitator signer for verification and execution
   * @param gasStationUrl - Optional gas station URL for sponsored transactions
   */
  constructor(
    private readonly signer: FacilitatorSuiSigner,
    private readonly gasStationUrl?: string,
  ) {}

  /**
   * Get mechanism-specific extra data for the supported kinds endpoint.
   * For Sui, returns gasStation URL if this facilitator supports sponsorship.
   *
   * @param _ - The network identifier (unused)
   * @returns Extra data object with gasStation URL, or undefined
   */
  getExtra(_: string): Record<string, unknown> | undefined {
    if (this.gasStationUrl) {
      return { gasStation: this.gasStationUrl };
    }
    return undefined;
  }

  /**
   * Get signer addresses used by this facilitator.
   * For Sui, returns addresses available for gas sponsorship.
   *
   * @param _ - The network identifier (unused)
   * @returns Array of signer addresses
   */
  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  /**
   * Verifies a payment payload per the official Sui spec.
   * Four verification steps (run independently where possible):
   * 1. Network match
   * 2. Signature verification (recovers payer address)
   * 3. Transaction simulation (dry-run)
   * 4. Balance change verification
   *
   * NOTE: maxTimeoutSeconds from PaymentRequirements is not enforced here.
   * This is a protocol-wide gap (EVM/SVM don't enforce it either). Sui
   * transactions use epoch-based expiry, not wall-clock timeouts. A future
   * version could validate that the TX expiration epoch is within bounds.
   *
   * @param payload - The payment payload to verify
   * @param requirements - The payment requirements
   * @returns Promise resolving to verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Step 0: Validate scheme
    if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
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

    const suiPayload = payload.payload as ExactSuiPayload;

    // Validate payload structure
    if (!suiPayload?.transaction || !suiPayload?.signature) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_sui_payload_transaction_could_not_be_decoded",
        payer: undefined,
      };
    }

    // Run independent verification steps in parallel:
    // Step 2: Signature verification → recovers the payer address
    // Step 3: Simulation → gets balance changes and proves tx would succeed
    let payer: string;
    try {
      const [recoveredPayer, dryRunResult] = await Promise.all([
        this.signer.verifySignature(
          suiPayload.transaction,
          suiPayload.signature,
          requirements.network,
        ),
        this.signer.simulateTransaction(suiPayload.transaction, requirements.network),
      ]);

      payer = recoveredPayer;

      // Check simulation status
      if (dryRunResult.effects?.status?.status !== "success") {
        return {
          isValid: false,
          invalidReason: "invalid_exact_sui_payload_transaction_dry_run_failed",
          invalidMessage: dryRunResult.effects?.status?.error || "Simulation failed",
          payer,
        };
      }

      // Step 4: Verify balance changes from dry-run
      // BalanceChange.owner is ObjectOwner: { AddressOwner: string } | { ObjectOwner: string } | ...
      const balanceChanges = dryRunResult.balanceChanges ?? [];

      // Find the recipient's balance change for the required coin type
      const recipientChange = balanceChanges.find(
        bc =>
          this.extractAddress(bc.owner) === requirements.payTo &&
          coinTypesEqual(bc.coinType, requirements.asset),
      );

      if (!recipientChange) {
        // Determine if it's a recipient mismatch or asset mismatch
        const anyRecipientChange = balanceChanges.find(
          bc => this.extractAddress(bc.owner) === requirements.payTo,
        );

        if (anyRecipientChange) {
          return {
            isValid: false,
            invalidReason: "invalid_exact_sui_payload_asset_mismatch",
            payer,
          };
        }

        return {
          isValid: false,
          invalidReason: "invalid_exact_sui_payload_recipient_mismatch",
          payer,
        };
      }

      // Verify the amount is sufficient (positive amount means funds received)
      const receivedAmount = BigInt(recipientChange.amount);
      if (receivedAmount < BigInt(requirements.amount)) {
        return {
          isValid: false,
          invalidReason: "invalid_exact_sui_payload_amount_insufficient",
          payer,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Classify the error based on which step failed
      if (
        errorMessage.includes("Signature verification failed") ||
        errorMessage.includes("Invalid signature")
      ) {
        return {
          isValid: false,
          invalidReason: "invalid_exact_sui_payload_transaction_signature_verification_failed",
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

  /**
   * Settles a payment by broadcasting the signed transaction.
   * Re-verifies the payment before broadcasting (defense-in-depth).
   *
   * @param payload - The payment payload to settle
   * @param requirements - The payment requirements
   * @returns Promise resolving to settlement response
   */
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

    const suiPayload = payload.payload as ExactSuiPayload;

    try {
      // Execute the transaction on-chain
      // TODO(sponsorship): When gas sponsorship is implemented, pass [clientSig, sponsorSig] here.
      // See spec appendix "Sponsored Transactions" and FacilitatorSuiSigner.executeTransaction().
      const digest = await this.signer.executeTransaction(
        suiPayload.transaction,
        suiPayload.signature,
        requirements.network,
      );

      // Wait for finality
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

  /**
   * Extract the Sui address from an ObjectOwner in balance changes.
   * Only matches AddressOwner — ObjectOwner (child objects) and Shared/Immutable
   * are not valid payment recipients.
   *
   * @param owner - The ObjectOwner from a BalanceChange
   * @returns The extracted address string, or empty string if not an address owner
   */
  private extractAddress(owner: unknown): string {
    if (typeof owner === "string") return "";
    if (owner && typeof owner === "object") {
      if ("AddressOwner" in owner) return (owner as { AddressOwner: string }).AddressOwner;
    }
    return "";
  }
}
