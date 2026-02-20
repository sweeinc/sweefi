/**
 * @module @sweefi/sdk
 *
 * s402 payment middleware for AI agents on Sui.
 *
 * Quick start:
 *   import { createS402Client, s402Gate } from '@sweefi/sdk';
 *
 * Subpath exports also available:
 * - @sweefi/sdk/client — client-side only
 * - @sweefi/sdk/server — server-side only
 */

// Re-export primary API surface from root for convenience
export { createS402Client, wrapFetchWithS402, adaptWallet } from "./client/index";
export type { s402ClientConfig, s402FetchOptions } from "./client/index";
export { s402Gate } from "./server/index";
export type { s402GateConfig } from "./server/index";

// Shared types
export type { SuiNetwork, Price } from "./shared/types";

// Core — types, clients, errors, config (merged from @sweefi/core)
export type { MessageEnvelope, MessageType } from "./types/message-envelope.js";
export { createMessageEnvelope } from "./types/message-envelope.js";
export type { NetworkConfig, SealKeyServerConfig } from "./types/network.js";
export { NETWORKS } from "./types/network.js";
export { COIN_TYPES, TESTNET_COIN_TYPES, COIN_DECIMALS } from "./types/coin-types.js";
export type { CoinType } from "./types/coin-types.js";
export type { SuiAddress, ObjectId } from "./types/addresses.js";
export { toSuiAddress, toObjectId, isValidSuiAddress } from "./types/addresses.js";
export { SweeErrorCode } from "./errors/error-codes.js";
export { SweeError } from "./errors/base-errors.js";
export { FeatureFlags } from "./config/feature-flags.js";
export { getSealKeyServers, getSealThreshold } from "./config/seal-key-servers.js";
export { createSuiClient } from "./clients/sui-client-factory.js";
export type { SweeSealClient, CreateSealClientOptions } from "./clients/seal-client-factory.js";
export { createSealClient } from "./clients/seal-client-factory.js";
export { createWalrusClient } from "./clients/walrus-client-factory.js";
export type { WalrusNetwork } from "./clients/walrus-client-factory.js";
export type { SweeLogger } from "./logging/logger.js";
export { defaultLogger } from "./logging/logger.js";
