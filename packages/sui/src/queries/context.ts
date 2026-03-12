import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { SweefiPluginConfig } from '../utils/config.js';

/**
 * Shared context for all query modules.
 * Provides transport-agnostic access to on-chain data via CoreClient.
 */
export interface QueryContext {
  client: ClientWithCoreApi;
  config: SweefiPluginConfig;
}
