/// SweeFi SEAL Policy — pay-to-decrypt via EscrowReceipt
///
/// Integrates SweeFi escrow with Sui SEAL (Secret Encryption and Access Library).
/// Enables the pay-to-decrypt pattern:
///
///   1. Buyer creates escrow → escrow_id is known immediately
///   2. Seller encrypts deliverable with key ID = [escrow_id][nonce]
///      (seller can encrypt BEFORE release — escrow_id is deterministic)
///   3. Buyer releases escrow → receives EscrowReceipt
///   4. Buyer presents EscrowReceipt to SEAL key server → decrypts deliverable
///
/// The SEAL key server calls `seal_approve` in a dry-run transaction.
/// If it doesn't abort, the decryption key is released to the caller.
///
/// Security properties:
///   - Only the current holder of the EscrowReceipt can decrypt (bearer model)
///   - Only receipts matching the escrow_id can decrypt
///   - Receipts are non-forgeable (minted only by escrow::release)
///   - Receipts have `store` — transferring the receipt transfers decryption rights
///   - Sui's object ownership model enforces holder-only access: only the address
///     that owns the receipt object can present it in a transaction (no sender check needed)
///
/// Error codes: 300-series (payment=0, stream=100, escrow=200, seal=300)
#[allow(lint(self_transfer))]
module sweefi::seal_policy {
    use sweefi::escrow;

    const ENoAccess: u64 = 300;

    // ══════════════════════════════════════════════════════════════
    // SEAL entry point
    // ══════════════════════════════════════════════════════════════

    /// SEAL approval: verifies the caller currently holds an EscrowReceipt matching the key ID.
    ///
    /// Key ID format: [escrow_id_bytes][arbitrary_nonce]
    ///   - escrow_id = 32 bytes (the ID of the resolved Escrow object)
    ///   - nonce = arbitrary bytes (allows multiple encrypted items per escrow)
    ///
    /// The seller encrypts content using this key format at escrow creation time.
    /// Any current holder of the matching EscrowReceipt can decrypt — including
    /// secondary buyers and AI agents who received the receipt via delegation.
    ///
    /// SECURITY: No explicit ctx.sender() check is performed here. This is intentional
    /// (H-1 fix). Sui's object ownership model guarantees that only the address currently
    /// owning the EscrowReceipt can include it as a transaction argument. The ownership
    /// IS the authorization — adding a redundant sender check would be noise that
    /// obscures the real security property and breaks the bearer model.
    ///
    /// `_ctx` is prefixed with underscore because it is intentionally unused after the H-1
    /// fix. It remains in the signature because the SEAL key server interface requires a
    /// &TxContext parameter for consistency across all seal_approve implementations.
    entry fun seal_approve(
        id: vector<u8>,
        receipt: &escrow::EscrowReceipt,
        ctx: &TxContext,
    ) {
        assert!(check_policy(id, receipt, ctx), ENoAccess);
    }

    // ══════════════════════════════════════════════════════════════
    // Policy logic (testable)
    // ══════════════════════════════════════════════════════════════

    /// Check that:
    ///   1. Key ID starts with the escrow_id from the receipt
    ///
    /// No address check needed: Sui object ownership guarantees only the current
    /// receipt holder can present it. Bearer model — transfer = transfer of access.
    ///
    /// Prefix match (not exact match) enables the nonce pattern: a seller can
    /// encrypt multiple deliverables for the same escrow using distinct nonces
    /// (escrow_id || nonce_1, escrow_id || nonce_2) without needing separate escrows.
    fun check_policy(
        id: vector<u8>,
        receipt: &escrow::EscrowReceipt,
        _ctx: &TxContext,
    ): bool {
        // Key ID must start with the escrow_id bytes
        let prefix = escrow::receipt_escrow_id(receipt).to_bytes();
        let prefix_len = prefix.length();
        if (prefix_len > id.length()) {
            return false
        };

        let mut i = 0;
        while (i < prefix_len) {
            if (prefix[i] != id[i]) {
                return false
            };
            i = i + 1;
        };
        true
    }
}
