import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeatureFlags } from '../src/config/feature-flags.js';

describe('FeatureFlags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('when no env vars are set', () => {
    it('should default SEAL_ENCRYPTION to true', () => {
      delete process.env.SWEE_SEAL_ENCRYPTION;
      expect(FeatureFlags.SEAL_ENCRYPTION).toBe(true);
    });

    it('should default SEAL_POLICY_EVALUATION to true', () => {
      delete process.env.SWEE_SEAL_POLICY_EVALUATION;
      expect(FeatureFlags.SEAL_POLICY_EVALUATION).toBe(true);
    });

    it('should default SUI_STACK_MESSAGING to false', () => {
      delete process.env.SWEE_SUI_STACK_MESSAGING;
      expect(FeatureFlags.SUI_STACK_MESSAGING).toBe(false);
    });

    it('should default NAUTILUS_TEE to false', () => {
      delete process.env.SWEE_NAUTILUS_TEE;
      expect(FeatureFlags.NAUTILUS_TEE).toBe(false);
    });

    it('should default ATOMA_INFERENCE to false', () => {
      delete process.env.SWEE_ATOMA_INFERENCE;
      expect(FeatureFlags.ATOMA_INFERENCE).toBe(false);
    });
  });

  describe('when env vars override defaults', () => {
    it('should read "true" as true', () => {
      process.env.SWEE_SUI_STACK_MESSAGING = 'true';
      expect(FeatureFlags.SUI_STACK_MESSAGING).toBe(true);
    });

    it('should read "1" as true', () => {
      process.env.SWEE_NAUTILUS_TEE = '1';
      expect(FeatureFlags.NAUTILUS_TEE).toBe(true);
    });

    it('should read "false" as false', () => {
      process.env.SWEE_SEAL_ENCRYPTION = 'false';
      expect(FeatureFlags.SEAL_ENCRYPTION).toBe(false);
    });

    it('should read "0" as false', () => {
      process.env.SWEE_SEAL_ENCRYPTION = '0';
      expect(FeatureFlags.SEAL_ENCRYPTION).toBe(false);
    });
  });
});
