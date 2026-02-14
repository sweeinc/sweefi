// Types
export type {
  MessageEnvelope,
  MessageType,
} from './types/message-envelope.js';
export { createMessageEnvelope } from './types/message-envelope.js';

export type {
  SuiNetwork,
  NetworkConfig,
  SealKeyServerConfig,
} from './types/network.js';
export { NETWORKS } from './types/network.js';

export { COIN_TYPES, TESTNET_COIN_TYPES, COIN_DECIMALS } from './types/coin-types.js';
export type { CoinType } from './types/coin-types.js';

export type { SuiAddress, ObjectId } from './types/addresses.js';
export {
  toSuiAddress,
  toObjectId,
  isValidSuiAddress,
} from './types/addresses.js';

// Errors
export { SweeErrorCode } from './errors/error-codes.js';
export { SweeError } from './errors/base-errors.js';

// Config
export { FeatureFlags } from './config/feature-flags.js';
export {
  getSealKeyServers,
  getSealThreshold,
} from './config/seal-key-servers.js';

// Client factories
export { createSuiClient } from './clients/sui-client-factory.js';
export type { SweeSealClient, CreateSealClientOptions } from './clients/seal-client-factory.js';
export { createSealClient } from './clients/seal-client-factory.js';
export { createWalrusClient } from './clients/walrus-client-factory.js';
export type { WalrusNetwork } from './clients/walrus-client-factory.js';

// Logging
export type { SweeLogger } from './logging/logger.js';
export { defaultLogger } from './logging/logger.js';

// s402 protocol (Sui-native HTTP 402 transport layer)
export * from './s402/index.js';
