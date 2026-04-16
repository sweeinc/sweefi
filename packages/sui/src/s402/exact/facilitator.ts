/**
 * s402 Exact Scheme — Facilitator
 *
 * Verifies and settles exact payment transactions.
 * 4-step verification logic:
 *   1. Scheme validation
 *   2. Network match
 *   3. Signature recovery + dry-run simulation
 *   4. Balance change verification
 *
 * Enhanced: settle() calls waitForTransaction() for finality confirmation.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402ExactPayload,
} from 's402';
import { Transaction } from '@mysten/sui/transactions';
import type { FacilitatorSuiSigner } from '../../signer.js';
import { coinTypesEqual } from '../../utils.js';

/** Default max gas budget a sponsor will co-sign (0.01 SUI = 10M MIST) */
export const DEFAULT_MAX_SPONSOR_GAS_BUDGET = 10_000_000n;

export class ExactSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'exact' as const;
  private readonly maxSponsorGasBudget: bigint;

  constructor(
    private readonly signer: FacilitatorSuiSigner,
    maxSponsorGasBudget?: bigint,
  ) {
    this.maxSponsorGasBudget = maxSponsorGasBudget ?? DEFAULT_MAX_SPONSOR_GAS_BUDGET;
  }

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'exact') {
      return { valid: false, invalidReason: 'Expected exact scheme' };
    }

    const exactPayload = payload as s402ExactPayload;
    const { transaction, signature } = exactPayload.payload;

    if (!transaction || !signature) {
      return { valid: false, invalidReason: 'Missing transaction or signature' };
    }

    try {
      // Parallel: signature verification + dry-run simulation
      const [payerAddress, dryRunResult] = await Promise.all([
        this.signer.verifySignature(transaction, signature, requirements.network),
        this.signer.simulateTransaction(transaction, requirements.network),
      ]);

      // Check simulation success
      if (dryRunResult.effects?.status?.status !== 'success') {
        return {
          valid: false,
          invalidReason: `Dry-run failed: ${dryRunResult.effects?.status?.error ?? 'unknown'}`,
          payerAddress,
        };
      }

      // Verify balance changes — two-branch logic for fee splits (F02 fix)
      const balanceChanges = dryRunResult.balanceChanges ?? [];
      const { protocolFeeBps, protocolFeeAddress } = requirements;

      // Defense-in-depth: reject invalid feeBps from untrusted requirements
      if (protocolFeeBps !== undefined && (!Number.isInteger(protocolFeeBps) || protocolFeeBps < 0 || protocolFeeBps > 10000)) {
        return { valid: false, invalidReason: `protocolFeeBps out of range: ${protocolFeeBps}`, payerAddress };
      }

      if (protocolFeeBps && protocolFeeBps > 0 && protocolFeeAddress && protocolFeeAddress !== requirements.payTo) {
        // FEE SPLIT MODE: merchant gets (amount - fee), fee address gets fee
        const totalAmount = BigInt(requirements.amount);
        const feeAmount = (totalAmount * BigInt(protocolFeeBps)) / 10000n;
        const merchantAmount = totalAmount - feeAmount;

        const merchantChange = balanceChanges.find(
          bc => extractAddress(bc.owner) === requirements.payTo &&
                coinTypesEqual(bc.coinType, requirements.asset),
        );
        if (!merchantChange) {
          return { valid: false, invalidReason: 'Merchant did not receive expected coin type', payerAddress };
        }
        const merchantReceived = BigInt(merchantChange.amount);
        if (merchantReceived < merchantAmount) {
          return { valid: false, invalidReason: `Merchant amount ${merchantReceived} below required ${merchantAmount}`, payerAddress };
        }

        // Check fee recipient received enough (skip when fee rounds to zero)
        if (feeAmount > 0n) {
          const feeChange = balanceChanges.find(
            bc => extractAddress(bc.owner) === protocolFeeAddress &&
                  coinTypesEqual(bc.coinType, requirements.asset),
          );
          if (!feeChange) {
            return { valid: false, invalidReason: 'Fee recipient did not receive expected coin type', payerAddress };
          }
          const feeReceived = BigInt(feeChange.amount);
          if (feeReceived < feeAmount) {
            return { valid: false, invalidReason: `Protocol fee ${feeReceived} below required ${feeAmount}`, payerAddress };
          }
        }
      } else {
        // NO FEE SPLIT: payTo gets full amount (fee address absent, same as payTo, or feeBps=0)
        const recipientChange = balanceChanges.find(
          bc => extractAddress(bc.owner) === requirements.payTo &&
                coinTypesEqual(bc.coinType, requirements.asset),
        );
        if (!recipientChange) {
          return { valid: false, invalidReason: 'Recipient did not receive expected coin type', payerAddress };
        }
        const received = BigInt(recipientChange.amount);
        const required = BigInt(requirements.amount);
        if (received < required) {
          return { valid: false, invalidReason: `Amount ${received} below required ${required}`, payerAddress };
        }
      }

      return { valid: true, payerAddress };
    } catch (error) {
      return {
        valid: false,
        invalidReason: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  async settle(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
    options?: { skipVerify?: boolean },
  ): Promise<s402SettleResponse> {
    // Defense-in-depth: re-verify (skippable on zero-cost-failure chains like Sui)
    if (!options?.skipVerify) {
      const verification = await this.verify(payload, requirements);
      if (!verification.valid) {
        return { success: false, error: verification.invalidReason };
      }
    }

    const exactPayload = payload as s402ExactPayload;
    const { transaction, signature: clientSig } = exactPayload.payload;

    try {
      const startMs = Date.now();

      // Determine signatures: single (standard) or dual (gas-sponsored)
      let signatures: string | string[] = clientSig;
      let gasSponsored = false;

      if (this.signer.sponsorSign) {
        const sponsorAddresses = this.signer.getAddresses();
        if (sponsorAddresses.length > 0) {
          // Deserialize to inspect gasData.owner
          const tx = Transaction.from(transaction);
          const gasOwner = tx.getData().gasData.owner;

          if (gasOwner && sponsorAddresses.includes(gasOwner)) {
            // Drain prevention: reject transactions whose commands reference
            // GasCoin. Without this, a client can craft SplitCoins(GasCoin, [amt])
            // to extract value from the sponsor's gas coin beyond gas fees.
            // Mirrors sui-gas-station's assertNoGasCoinUsage (policy.ts).
            if (commandsReferenceGasCoin(tx.getData().commands)) {
              return {
                success: false,
                error: 'Transaction commands reference GasCoin — gas coin manipulation is not allowed in sponsored transactions',
              };
            }

            // Enforce gas budget: reject zero (undefined budget bypass) and over-cap
            const gasBudget = BigInt(tx.getData().gasData.budget ?? 0);
            if (gasBudget === 0n || gasBudget > this.maxSponsorGasBudget) {
              return {
                success: false,
                error: gasBudget === 0n
                  ? 'Gas budget is zero or missing — sponsor requires a declared budget'
                  : `Gas budget ${gasBudget} exceeds sponsor limit ${this.maxSponsorGasBudget}`,
              };
            }

            // Co-sign as gas sponsor
            const sponsorSig = await this.signer.sponsorSign(transaction);
            signatures = [clientSig, sponsorSig];
            gasSponsored = true;
          }
        }
      }

      // Execute on-chain
      const txDigest = await this.signer.executeTransaction(
        transaction,
        signatures,
        requirements.network,
      );

      // Wait for finality (hardened per expert review)
      await this.signer.waitForTransaction(txDigest, requirements.network);

      const finalityMs = Date.now() - startMs;

      return {
        success: true,
        txDigest,
        finalityMs,
        gasSponsored,
      } as s402SettleResponse;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

/**
 * Check if any PTB command references the GasCoin input.
 * Prevents drain attacks where a malicious sender crafts kind bytes with
 * SplitCoins(GasCoin, [amount]) + TransferObjects to extract value from
 * the sponsor's gas coin beyond gas fees.
 */
function commandsReferenceGasCoin(
  commands: ReturnType<Transaction['getData']>['commands'],
): boolean {
  for (const command of commands) {
    const args = getCommandArguments(command);
    if (args.some((a) => a.$kind === 'GasCoin')) return true;
  }
  return false;
}

/** Extract all arguments from a PTB command for GasCoin inspection. */
function getCommandArguments(
  command: ReturnType<Transaction['getData']>['commands'][number],
): Array<{ $kind: string }> {
  switch (command.$kind) {
    case 'SplitCoins':
      return [command.SplitCoins.coin, ...command.SplitCoins.amounts];
    case 'TransferObjects':
      return [...command.TransferObjects.objects, command.TransferObjects.address];
    case 'MergeCoins':
      return [command.MergeCoins.destination, ...command.MergeCoins.sources];
    case 'MoveCall':
      return command.MoveCall.arguments;
    case 'MakeMoveVec':
      return command.MakeMoveVec.elements;
    case 'Upgrade':
      return [command.Upgrade.ticket];
    case 'Publish':
      return [];
    default:
      return [];
  }
}

function extractAddress(owner: unknown): string {
  if (typeof owner === 'string') return '';
  if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
    return (owner as { AddressOwner: string }).AddressOwner;
  }
  return '';
}
