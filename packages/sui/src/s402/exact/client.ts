/**
 * s402 Exact Scheme — Client
 *
 * Builds a signed payment PTB for one-shot exact payments.
 * Reuses existing PTB logic: coinWithBalance() → transferObjects().
 *
 * FEE COLLECTION (v0.2):
 * When `protocolFeeAddress` is set in requirements and differs from `payTo`,
 * the client splits the payment: merchant gets (amount - fee), fee address
 * gets fee. The facilitator verifies both recipients via dry-run balance changes.
 *
 * MANDATE SUPPORT (v0.2):
 * When `requirements.mandate.required` is true and `mandateConfig` is provided,
 * the PTB prepends a `mandate::validate_and_spend` MoveCall before the payment.
 * The mandate check and payment compose atomically — if either fails, the whole
 * transaction reverts. The mandate is purely an authorization check; it does NOT
 * hold funds. The actual payment uses the exact scheme's coinWithBalance pattern.
 */

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import type { s402ClientScheme, s402PaymentRequirements, s402ExactPayload } from 's402';
import { S402_VERSION } from 's402';
import type { ClientSuiSigner } from '../../signer.js';
import { SUI_CLOCK } from '../../ptb/deployments.js';

/**
 * Optional mandate configuration for agents with spending authorization.
 * When provided, the scheme can build mandated PTBs that include on-chain
 * spending validation via `mandate::validate_and_spend`.
 */
export interface ExactSuiClientSchemeConfig {
  /** Mandate object ID (owned by this agent/delegate) */
  mandateId: string;
  /** RevocationRegistry object ID (shared object, required for revocation checks) */
  registryId: string;
  /** SweeFi Move package ID (for mandate::validate_and_spend target) */
  packageId: string;
}

export class ExactSuiClientScheme implements s402ClientScheme {
  readonly scheme = 'exact' as const;

  /**
   * Per-call memo, set by the s402 client fetch wrapper before createPayment().
   * Cleared after each createPayment() call to avoid leaking into subsequent requests.
   * The memo is embedded in the PTB as a MoveCall event (not a Move receipt — that
   * requires packageId). When packageId is unavailable, the memo is silently skipped.
   *
   * @internal Used by createS402Client's fetch wrapper — not part of the public API.
   */
  _pendingMemo: string | undefined;

  constructor(
    private readonly signer: ClientSuiSigner,
    private readonly mandateConfig?: ExactSuiClientSchemeConfig,
    private readonly packageId?: string,
  ) {}

  async createPayment(
    requirements: s402PaymentRequirements,
  ): Promise<s402ExactPayload> {
    const { amount, asset, payTo, protocolFeeBps, protocolFeeAddress } = requirements;

    // Consume pending memo (cleared after use to prevent leaking into next call)
    const memo = this._pendingMemo;
    this._pendingMemo = undefined;

    const tx = new Transaction();
    tx.setSender(this.signer.address);

    // Gas sponsorship: if server advertises a gas station, set gasOwner so
    // the facilitator co-signs and pays gas on behalf of the client.
    const gasStation = requirements.extensions?.gasStation as
      { sponsorAddress: string; maxBudget?: string } | undefined;
    if (gasStation?.sponsorAddress) {
      tx.setGasOwner(gasStation.sponsorAddress);
      if (gasStation.maxBudget) {
        tx.setGasBudget(BigInt(gasStation.maxBudget));
      }
    }

    // Mandate check: prepend validate_and_spend if server requires authorization
    if (requirements.mandate?.required) {
      if (!this.mandateConfig) {
        throw new Error(
          'Server requires mandate authorization but no mandate is configured. ' +
          'Pass mandateConfig to ExactSuiClientScheme constructor.',
        );
      }
      const { mandateId, registryId, packageId } = this.mandateConfig;
      tx.moveCall({
        target: `${packageId}::mandate::validate_and_spend`,
        typeArguments: [asset],
        arguments: [
          tx.object(mandateId),
          tx.pure.u64(BigInt(amount)),
          tx.object(registryId),
          tx.object(SUI_CLOCK),
        ],
      });
    }

    const totalAmount = BigInt(amount);

    // Resolve the effective package ID for Move calls (memo-bearing payments
    // use payment::pay_and_keep which requires the SweeFi package).
    const effectivePackageId = this.packageId ?? this.mandateConfig?.packageId;

    // When a memo is provided AND we have a packageId, use payment::pay_and_keep
    // to create an on-chain PaymentReceipt with the memo in its vector<u8> field.
    // Without packageId, the memo cannot be written on-chain — warn the caller.
    if (memo && !effectivePackageId) {
      console.warn("[sweefi/sui] Warning: memo provided but packageId not configured — memo will not be written on-chain. Idempotency keys require packageId.");
    }
    if (memo && effectivePackageId) {
      const memoBytes = new TextEncoder().encode(memo);

      // Fee computation: convert protocolFeeBps (wire: bps, 10000 = 100%)
      // to micro-percent (on-chain: 1,000,000 = 100%) per ADR-003.
      const feeMicroPercent = protocolFeeBps ? protocolFeeBps * 100 : 0;
      const feeAddress = protocolFeeAddress ?? payTo;

      const coin = coinWithBalance({ type: asset, balance: totalAmount });
      tx.moveCall({
        target: `${effectivePackageId}::payment::pay_and_keep`,
        typeArguments: [asset],
        arguments: [
          coin,
          tx.pure.address(payTo),
          tx.pure.u64(totalAmount),
          tx.pure.u64(feeMicroPercent),
          tx.pure.address(feeAddress),
          tx.pure.vector('u8', Array.from(memoBytes)),
          tx.object(SUI_CLOCK),
        ],
      });
    } else if (protocolFeeBps && protocolFeeBps > 0) {
      // Split payment: merchant gets (amount - fee), protocol gets fee
      const feeAmount = (totalAmount * BigInt(protocolFeeBps)) / 10000n;
      const merchantAmount = totalAmount - feeAmount;
      const feeAddress = protocolFeeAddress ?? payTo;

      // V8 audit F-17: Skip the fee split when feeAmount rounds to zero.
      // This avoids creating a dust 0-value coin object that wastes gas.
      if (feeAmount === 0n) {
        const coin = coinWithBalance({ type: asset, balance: totalAmount });
        tx.transferObjects([coin], payTo);
      } else {
        // Single coin source, split into two
        const coin = coinWithBalance({ type: asset, balance: totalAmount });
        const [merchantCoin, feeCoin] = tx.splitCoins(coin, [merchantAmount, feeAmount]);
        tx.transferObjects([merchantCoin], payTo);
        tx.transferObjects([feeCoin], feeAddress);
      }
    } else {
      // Simple transfer — no fee split
      const coin = coinWithBalance({ type: asset, balance: totalAmount });
      tx.transferObjects([coin], payTo);
    }

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      s402Version: S402_VERSION,
      scheme: 'exact',
      payload: {
        transaction: bytes,
        signature,
      },
    };
  }
}
