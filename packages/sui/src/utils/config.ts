import type { SuiClientTypes } from '@mysten/sui/client';
import { ConfigurationError, SweefiErrorCode, ErrorMessages, ValidationError } from './errors.js';
import {
  TESTNET_PACKAGE_ID,
  TESTNET_PROTOCOL_STATE,
  TESTNET_ADMIN_CAP,
} from '../ptb/deployments.js';

interface NetworkDefaults {
  packageId: string;
  protocolState: string;
  adminCap: string;
}

/** Single source of truth: import from existing deployments.ts */
const NETWORK_DEFAULTS: Partial<Record<string, NetworkDefaults>> = {
  testnet: {
    packageId: TESTNET_PACKAGE_ID,
    protocolState: TESTNET_PROTOCOL_STATE,
    adminCap: TESTNET_ADMIN_CAP,
  },
  // mainnet: { ... } — uncommented when mainnet deploys
};

export interface CoinConfig {
  decimals: number;
}

/**
 * Configuration for the $extend() plugin. Resolves network-specific defaults
 * from deployments.ts and validates required fields.
 *
 * Not to be confused with the legacy SweefiConfig interface in ptb/types.ts —
 * this class replaces it for the new $extend() API.
 */
export class SweefiPluginConfig {
  readonly packageId: string;
  readonly protocolState?: string;
  readonly adminCap?: string;
  readonly network: string;
  readonly SUI_CLOCK = '0x6';

  #coinTypes: Record<string, CoinConfig>;

  constructor(options: {
    packageId?: string;
    protocolState?: string;
    adminCap?: string;
    network: SuiClientTypes.Network;
    coinTypes?: Record<string, CoinConfig>;
  }) {
    const defaults = NETWORK_DEFAULTS[options.network];

    const packageId = options.packageId ?? defaults?.packageId;
    if (!packageId) {
      throw new ConfigurationError(
        SweefiErrorCode.PACKAGE_ID_REQUIRED,
        ErrorMessages[SweefiErrorCode.PACKAGE_ID_REQUIRED],
      );
    }

    this.packageId = packageId;
    this.protocolState = options.protocolState ?? defaults?.protocolState;
    this.adminCap = options.adminCap ?? defaults?.adminCap;
    this.network = options.network;
    this.#coinTypes = options.coinTypes ?? {};
  }

  getCoinDecimals(coinType: string): number {
    const config = this.#coinTypes[coinType];
    if (config) return config.decimals;
    if (coinType.includes('sui::SUI')) return 9;
    throw new ValidationError(`Unknown coin decimals for ${coinType} — configure via coinTypes option`);
  }

  requireProtocolState(): string {
    if (!this.protocolState) {
      throw new ConfigurationError(
        SweefiErrorCode.PROTOCOL_STATE_NOT_SET,
        ErrorMessages[SweefiErrorCode.PROTOCOL_STATE_NOT_SET],
      );
    }
    return this.protocolState;
  }

  requireAdminCap(): string {
    if (!this.adminCap) {
      throw new ConfigurationError(
        SweefiErrorCode.ADMIN_CAP_NOT_SET,
        ErrorMessages[SweefiErrorCode.ADMIN_CAP_NOT_SET],
      );
    }
    return this.adminCap;
  }
}
