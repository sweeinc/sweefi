/**
 * SweeFi $extend() plugin — the single entry point for payment capabilities.
 *
 * Usage:
 *   import { SuiGrpcClient } from '@mysten/sui/grpc';
 *   import { sweefi } from '@sweefi/sui';
 *
 *   const client = new SuiGrpcClient({ network: 'testnet' })
 *     .$extend(sweefi());
 *
 *   // Transaction builders
 *   const tx = new Transaction();
 *   tx.add(client.sweefi.payment.pay({ ... }));
 *   tx.add(client.sweefi.stream.create({ ... }));
 *
 *   // Queries (transport-agnostic via client.core)
 *   const stream = await client.sweefi.getStream('0x...');
 *   const paused = await client.sweefi.isProtocolPaused();
 */
import type { ClientWithCoreApi, SuiClientRegistration, SuiClientTypes } from '@mysten/sui/client';
import { SweefiPluginConfig } from './utils/config.js';
import type { CoinConfig } from './utils/config.js';
import { PaymentContract } from './transactions/payment.js';
import { StreamContract } from './transactions/stream.js';
import { EscrowContract } from './transactions/escrow.js';
import { PrepaidContract } from './transactions/prepaid.js';
import { MandateContract } from './transactions/mandate.js';
import { AgentMandateContract } from './transactions/agentMandate.js';
import { AdminContract } from './transactions/admin.js';
import type { QueryContext } from './queries/context.js';
import { StreamQueries } from './queries/streamQueries.js';
import type { StreamState } from './queries/streamQueries.js';
import { EscrowQueries } from './queries/escrowQueries.js';
import type { EscrowData } from './queries/escrowQueries.js';
import { PrepaidQueries } from './queries/prepaidQueries.js';
import type { PrepaidState } from './queries/prepaidQueries.js';
import { MandateQueries } from './queries/mandateQueries.js';
import type { MandateState } from './queries/mandateQueries.js';
import { ProtocolQueries } from './queries/protocolQueries.js';
import type { ProtocolStateData } from './queries/protocolQueries.js';
import { BalanceQueries } from './queries/balanceQueries.js';

// ── Compatible client type ───────────────────────────────────

/**
 * Minimum client requirement for the SweeFi extension.
 * Requires CoreClient for transport-agnostic queries.
 * Matches DeepBook's DeepBookCompatibleClient pattern.
 */
export interface SweefiCompatibleClient extends ClientWithCoreApi {}

// ── Options ──────────────────────────────────────────────────

export interface SweefiOptions<Name = 'sweefi'> {
  packageId?: string;
  protocolState?: string;
  adminCap?: string;
  coinTypes?: Record<string, CoinConfig>;
  name?: Name;
}

// ── Public API surface ───────────────────────────────────────

/** The public API surface exposed via $extend(). This is the contract — not SweefiClient. */
export interface SweefiPublicAPI {
  // Transaction builder namespaces
  readonly payment: PaymentContract;
  readonly stream: StreamContract;
  readonly escrow: EscrowContract;
  readonly prepaid: PrepaidContract;
  readonly mandate: MandateContract;
  readonly agentMandate: AgentMandateContract;
  readonly admin: AdminContract;

  // Query delegates
  getBalance(owner: string, coinType: string): Promise<bigint>;
  getStream(streamId: string): Promise<StreamState>;
  getEscrow(escrowId: string): Promise<EscrowData>;
  getPrepaidBalance(balanceId: string): Promise<PrepaidState>;
  getMandate(mandateId: string): Promise<MandateState>;
  isProtocolPaused(): Promise<boolean>;
  getProtocolState(): Promise<ProtocolStateData>;
}

// ── Client class ─────────────────────────────────────────────

/** Exported for testing/advanced use. Most users go through sweefi() + $extend(). */
export class SweefiClient implements SweefiPublicAPI {
  // Transaction builder namespaces
  readonly payment: PaymentContract;
  readonly stream: StreamContract;
  readonly escrow: EscrowContract;
  readonly prepaid: PrepaidContract;
  readonly mandate: MandateContract;
  readonly agentMandate: AgentMandateContract;
  readonly admin: AdminContract;

  // Private internals
  readonly #config: SweefiPluginConfig;
  readonly #balanceQueries: BalanceQueries;
  readonly #streamQueries: StreamQueries;
  readonly #escrowQueries: EscrowQueries;
  readonly #prepaidQueries: PrepaidQueries;
  readonly #mandateQueries: MandateQueries;
  readonly #protocolQueries: ProtocolQueries;

  constructor(options: SweefiOptions & { client: SweefiCompatibleClient; network: SuiClientTypes.Network }) {
    const config = new SweefiPluginConfig({
      packageId: options.packageId,
      protocolState: options.protocolState,
      adminCap: options.adminCap,
      network: options.network,
      coinTypes: options.coinTypes,
    });

    this.#config = config;

    // Transaction builders
    this.payment = new PaymentContract(config);
    this.stream = new StreamContract(config);
    this.escrow = new EscrowContract(config);
    this.prepaid = new PrepaidContract(config);
    this.mandate = new MandateContract(config);
    this.agentMandate = new AgentMandateContract(config);
    this.admin = new AdminContract(config);

    // Query modules — share a single QueryContext
    const ctx: QueryContext = { client: options.client, config };
    this.#balanceQueries = new BalanceQueries(ctx);
    this.#streamQueries = new StreamQueries(ctx);
    this.#escrowQueries = new EscrowQueries(ctx);
    this.#prepaidQueries = new PrepaidQueries(ctx);
    this.#mandateQueries = new MandateQueries(ctx);
    this.#protocolQueries = new ProtocolQueries(ctx);
  }

  // ── Query delegates ──────────────────────────────────────────

  getBalance(owner: string, coinType: string): Promise<bigint> {
    return this.#balanceQueries.getBalance(owner, coinType);
  }

  getStream(streamId: string): Promise<StreamState> {
    return this.#streamQueries.getStream(streamId);
  }

  getEscrow(escrowId: string): Promise<EscrowData> {
    return this.#escrowQueries.getEscrow(escrowId);
  }

  getPrepaidBalance(balanceId: string): Promise<PrepaidState> {
    return this.#prepaidQueries.getPrepaidBalance(balanceId);
  }

  getMandate(mandateId: string): Promise<MandateState> {
    return this.#mandateQueries.getMandate(mandateId);
  }

  isProtocolPaused(): Promise<boolean> {
    return this.#protocolQueries.isPaused();
  }

  getProtocolState(): Promise<ProtocolStateData> {
    return this.#protocolQueries.getProtocolState();
  }
}

// ── Factory function ─────────────────────────────────────────

/**
 * Create a SweeFi $extend() registration.
 *
 * Zero-config for testnet/mainnet (package IDs auto-filled from deployments.ts):
 *   client.$extend(sweefi())
 *
 * Custom config for localnet or custom deployments:
 *   client.$extend(sweefi({ packageId: '0x...', protocolState: '0x...' }))
 */
export function sweefi<Name extends string = 'sweefi'>(
  options?: SweefiOptions<Name>,
): SuiClientRegistration<SweefiCompatibleClient, Name, SweefiPublicAPI> {
  const { name = 'sweefi' as Name, ...rest } = options ?? {} as SweefiOptions<Name>;
  return {
    name,
    register: (client) => {
      return new SweefiClient({
        client,
        network: client.network,
        ...rest,
      });
    },
  };
}
