import { describe, it, expect } from 'vitest';
import {
  // Types
  NETWORKS,
  COIN_TYPES,
  COIN_DECIMALS,
  createMessageEnvelope,
  toSuiAddress,
  toObjectId,
  isValidSuiAddress,
  // Errors
  SweeError,
  SweeErrorCode,
  // Config
  FeatureFlags,
  getSealKeyServers,
  getSealThreshold,
  // Logging
  defaultLogger,
  // Client factory (just verify it's importable)
  createSuiClient,
} from '../src/index.js';

describe('@swee/core smoke test', () => {
  it('should export all expected symbols', () => {
    // Types & constants
    expect(NETWORKS).toBeDefined();
    expect(NETWORKS.testnet.fullnodeUrl).toContain('testnet');
    expect(COIN_TYPES.SUI).toBe('0x2::sui::SUI');
    expect(COIN_DECIMALS[COIN_TYPES.SUI]).toBe(9);

    // Message envelope
    expect(createMessageEnvelope).toBeTypeOf('function');

    // Addresses
    expect(toSuiAddress).toBeTypeOf('function');
    expect(toObjectId).toBeTypeOf('function');
    expect(isValidSuiAddress).toBeTypeOf('function');

    // Errors
    expect(SweeError).toBeTypeOf('function');
    expect(SweeErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');

    // Config
    expect(FeatureFlags).toBeDefined();
    expect(getSealKeyServers).toBeTypeOf('function');
    expect(getSealThreshold).toBeTypeOf('function');

    // Logging
    expect(defaultLogger).toBeDefined();
    expect(defaultLogger.info).toBeTypeOf('function');

    // Client factory
    expect(createSuiClient).toBeTypeOf('function');
  });
});
