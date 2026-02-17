/// SweePay AgentIdentity — soulbound on-chain identity for AI agents
///
/// Design principles (from 2-round adversarial review + 4 council deliberations):
///   - Identity emerges from payment data, not from an over-engineered registry
///   - One AgentIdentity per address, soulbound (key only — non-transferable)
///   - Receipt-linked recording: only PaymentReceipt proves real payments
///   - Receipt dedup: each receipt can only be recorded once (prevents replay inflation)
///   - Dynamic fields for extensibility (credentials, bonds, metadata)
///   - AdminCap-gated registry creation prevents shadow registries
///   - Soulbound but destructible: owner can destroy their own identity
///     (non-transferable, but allows address rotation and voluntary opt-out)
///
/// Known limitations:
///   - Phase B2: only covers exact payments (PaymentReceipt).
///     Escrow (EscrowReceipt), stream, and prepaid payments not yet recorded.
///     Phase B3 adds record_escrow_payment(). Stream/prepaid need receipt patterns.
///   - Self-payment: an agent can pay its own address to inflate volume.
///     Mitigated off-chain by weighting counterparty diversity in reputation
///     scoring. On-chain identity records raw data; interpretation is off-chain.
///   - B-13 (Destroy-recreate receipt replay): If an agent destroys their
///     identity and creates a new one, they can re-record the same receipts.
///     Dedup is per-identity (Table inside AgentIdentity), not global. This is
///     by design: global dedup would require a shared object for every record_payment
///     call, destroying the owned-object performance advantage. Off-chain indexers
///     can detect replay across identities by tracking receipt IDs globally.
///
/// Error codes: 700-series (payment=0, stream=100, escrow=200, seal=300,
///              mandate=400, admin/agent_mandate=500, prepaid=600, identity=700)
module sweepay::identity {
    use sui::clock::Clock;
    use sui::table::{Self, Table};
    use sweepay::admin::{Self, AdminCap, ProtocolState};
    use sweepay::payment::{Self, PaymentReceipt};

    // ══════════════════════════════════════════════════════════════
    // Error codes (700-series)
    // ══════════════════════════════════════════════════════════════

    const EAlreadyRegistered: u64 = 700;
    const ENotOwner: u64 = 701;
    #[allow(unused_const)]
    const EIdentityNotFound: u64 = 702;
    #[allow(unused_const)]
    const EInvalidCredential: u64 = 703;
    const EIdentityMismatch: u64 = 704;
    const EReceiptAlreadyRecorded: u64 = 705;

    // ══════════════════════════════════════════════════════════════
    // Structs
    // ══════════════════════════════════════════════════════════════

    /// Soulbound agent identity. `key` only — non-transferable.
    /// Only the defining module can call transfer::transfer on this type.
    /// Dynamic fields enable extensibility without contract upgrades.
    /// Owner can destroy their identity (soulbound ≠ permanent).
    public struct AgentIdentity has key {
        id: UID,
        /// The address this identity represents
        owner: address,
        /// When this identity was created (ms)
        created_at_ms: u64,
        /// Count of recorded payments
        total_payments: u64,
        /// Cumulative volume in base units (MIST)
        total_volume: u64,
        /// Last activity timestamp (ms) — used for decay calculations
        last_active_ms: u64,
        /// Receipt IDs already recorded — prevents replay inflation.
        /// Table<ID, bool> for O(1) lookups (replaces VecSet which was O(n)).
        recorded_receipts: Table<ID, bool>,
    }

    /// Shared registry for O(1) address → identity ID lookups.
    /// AdminCap-gated creation prevents shadow registries.
    /// Same pattern as RevocationRegistry but with Table<address, ID>.
    public struct IdentityRegistry has key {
        id: UID,
        identities: Table<address, ID>,
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct IdentityCreated has copy, drop {
        identity_id: ID,
        owner: address,
        created_at_ms: u64,
    }

    public struct PaymentRecorded has copy, drop {
        identity_id: ID,
        owner: address,
        recipient: address,
        amount: u64,
        total_payments: u64,
        total_volume: u64,
        timestamp_ms: u64,
    }

    public struct IdentityDestroyed has copy, drop {
        identity_id: ID,
        owner: address,
        total_payments: u64,
        total_volume: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Registry lifecycle (AdminCap-gated)
    // ══════════════════════════════════════════════════════════════

    /// Create the canonical IdentityRegistry. AdminCap-gated to prevent
    /// shadow registries. Called once after package upgrade.
    ///
    /// Deployment sequence:
    ///   1. sui client upgrade (adds identity module)
    ///   2. sui client call --function create_registry --args <admin_cap_id>
    ///   3. Save registry object ID to config
    #[allow(lint(public_entry))]
    public entry fun create_registry(
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        transfer::share_object(IdentityRegistry {
            id: object::new(ctx),
            identities: table::new(ctx),
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Identity lifecycle
    // ══════════════════════════════════════════════════════════════

    /// Mint a soulbound identity for the caller.
    /// Registers in the shared IdentityRegistry atomically.
    /// One identity per address — aborts if already registered.
    /// Guarded by protocol pause (consistent with escrow/stream/prepaid creation).
    public fun create(
        registry: &mut IdentityRegistry,
        protocol_state: &ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ): AgentIdentity {
        admin::assert_not_paused(protocol_state);
        let owner = ctx.sender();
        assert!(!registry.identities.contains(owner), EAlreadyRegistered);

        let now = clock.timestamp_ms();
        let identity = AgentIdentity {
            id: object::new(ctx),
            owner,
            created_at_ms: now,
            total_payments: 0,
            total_volume: 0,
            last_active_ms: now,
            recorded_receipts: table::new(ctx),
        };

        // Register in lookup table
        registry.identities.add(owner, object::id(&identity));

        sui::event::emit(IdentityCreated {
            identity_id: object::id(&identity),
            owner,
            created_at_ms: now,
        });

        identity
    }

    /// Convenience entry: create identity and transfer to caller.
    /// Naming follows mandate.move's create + create_and_transfer pattern.
    entry fun create_and_transfer(
        registry: &mut IdentityRegistry,
        protocol_state: &ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let owner = ctx.sender();
        let identity = create(registry, protocol_state, clock, ctx);
        transfer::transfer(identity, owner);
    }

    /// Destroy an identity and deregister from the registry.
    /// Only the owner can destroy their own identity.
    ///
    /// Design: Identities are soulbound (non-transferable) but destructible
    /// by their owner. Destruction permanently erases all reputation data.
    /// This covers address rotation and voluntary opt-out scenarios.
    public fun destroy(
        identity: AgentIdentity,
        registry: &mut IdentityRegistry,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == identity.owner, ENotOwner);

        registry.identities.remove(identity.owner);

        sui::event::emit(IdentityDestroyed {
            identity_id: object::id(&identity),
            owner: identity.owner,
            total_payments: identity.total_payments,
            total_volume: identity.total_volume,
        });

        let AgentIdentity {
            id, owner: _, created_at_ms: _, total_payments: _,
            total_volume: _, last_active_ms: _, recorded_receipts,
        } = identity;
        recorded_receipts.drop();
        object::delete(id);
    }

    // ══════════════════════════════════════════════════════════════
    // Payment recording (receipt-linked — tamper-proof)
    // ══════════════════════════════════════════════════════════════

    /// Record a payment against this identity using a PaymentReceipt as proof.
    ///
    /// Called in the SAME PTB as payment::pay() — atomic:
    ///   let receipt = payment::pay(coin, recipient, ...);
    ///   identity::record_payment(&mut my_identity, &receipt, clock, ctx);
    ///   transfer::public_transfer(receipt, sender);
    ///
    /// Checks:
    ///   1. Caller is the identity owner
    ///   2. Receipt payer matches identity owner (tamper-proof)
    ///   3. Receipt not already recorded (prevents replay inflation)
    ///
    /// Only the owner can record payments on their own identity.
    /// No "admin can record for you" — self-sovereign.
    public fun record_payment(
        identity: &mut AgentIdentity,
        receipt: &PaymentReceipt,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        // Only the owner can update their identity
        assert!(ctx.sender() == identity.owner, ENotOwner);

        // Receipt payer must match identity owner — no fake recordings
        assert!(payment::receipt_payer(receipt) == identity.owner, EIdentityMismatch);

        // Prevent receipt replay — same receipt cannot inflate counters
        let receipt_id = object::id(receipt);
        assert!(!identity.recorded_receipts.contains(receipt_id), EReceiptAlreadyRecorded);
        identity.recorded_receipts.add(receipt_id, true);

        identity.total_payments = identity.total_payments + 1;
        identity.total_volume = identity.total_volume + payment::receipt_amount(receipt);
        identity.last_active_ms = clock.timestamp_ms();

        sui::event::emit(PaymentRecorded {
            identity_id: object::id(identity),
            owner: identity.owner,
            recipient: payment::receipt_recipient(receipt),
            amount: payment::receipt_amount(receipt),
            total_payments: identity.total_payments,
            total_volume: identity.total_volume,
            timestamp_ms: clock.timestamp_ms(),
        });
    }

    /// Entry convenience for `record_payment` (for CLI / simple SDK callers).
    /// PTB callers should use the public fun directly for composability.
    entry fun record_payment_entry(
        identity: &mut AgentIdentity,
        receipt: &PaymentReceipt,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        record_payment(identity, receipt, clock, ctx);
    }

    // ══════════════════════════════════════════════════════════════
    // View functions
    // ══════════════════════════════════════════════════════════════

    /// Read-only UID accessor for dynamic field reads by external modules.
    /// Mutation is kept internal to preserve encapsulation — future
    /// credential/bond attachment will use explicit functions in this module.
    public fun uid(i: &AgentIdentity): &UID { &i.id }

    public fun owner(i: &AgentIdentity): address { i.owner }
    public fun created_at_ms(i: &AgentIdentity): u64 { i.created_at_ms }
    public fun total_payments(i: &AgentIdentity): u64 { i.total_payments }
    public fun total_volume(i: &AgentIdentity): u64 { i.total_volume }
    public fun last_active_ms(i: &AgentIdentity): u64 { i.last_active_ms }

    /// Age of this identity in milliseconds
    public fun age_ms(i: &AgentIdentity, clock: &Clock): u64 {
        clock.timestamp_ms() - i.created_at_ms
    }

    /// Whether the identity has been active within the threshold (ms)
    public fun is_active(i: &AgentIdentity, clock: &Clock, threshold_ms: u64): bool {
        clock.timestamp_ms() - i.last_active_ms <= threshold_ms
    }

    // ══════════════════════════════════════════════════════════════
    // Registry lookups
    // ══════════════════════════════════════════════════════════════

    /// Look up an identity ID by address. Returns None if not registered.
    public fun lookup(registry: &IdentityRegistry, addr: address): Option<ID> {
        if (registry.identities.contains(addr)) {
            option::some(*registry.identities.borrow(addr))
        } else {
            option::none()
        }
    }

    /// Check if an address has a registered identity.
    public fun is_registered(registry: &IdentityRegistry, addr: address): bool {
        registry.identities.contains(addr)
    }

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun create_registry_for_testing(ctx: &mut TxContext): IdentityRegistry {
        IdentityRegistry {
            id: object::new(ctx),
            identities: table::new(ctx),
        }
    }

    #[test_only]
    public fun destroy_for_testing(identity: AgentIdentity) {
        let AgentIdentity {
            id, owner: _, created_at_ms: _, total_payments: _,
            total_volume: _, last_active_ms: _, recorded_receipts,
        } = identity;
        recorded_receipts.drop();
        object::delete(id);
    }

    #[test_only]
    public fun destroy_registry_for_testing(registry: IdentityRegistry) {
        let IdentityRegistry { id, identities } = registry;
        identities.drop();
        object::delete(id);
    }
}
