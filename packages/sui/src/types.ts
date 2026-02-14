/**
 * Sui-specific payload for the Exact payment scheme.
 * Contains a signed-but-not-executed transaction per the official Sui spec.
 * The client signs and the facilitator broadcasts during settlement.
 */
export type ExactSuiPayload = {
  /**
   * Base64-encoded signature over the transaction bytes.
   * Supports all Sui signature schemes (Ed25519, Secp256k1, Secp256r1).
   */
  signature: string;

  /**
   * Base64-encoded Sui transaction bytes (BCS-serialized TransactionData)
   */
  transaction: string;
};
