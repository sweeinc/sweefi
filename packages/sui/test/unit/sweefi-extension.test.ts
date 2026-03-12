import { describe, it, expect } from 'vitest';
import { sweefi, SweefiClient } from '../../src/extend';
import { PaymentContract } from '../../src/transactions/payment';
import { StreamContract } from '../../src/transactions/stream';
import { EscrowContract } from '../../src/transactions/escrow';
import { PrepaidContract } from '../../src/transactions/prepaid';
import { MandateContract } from '../../src/transactions/mandate';
import { AgentMandateContract } from '../../src/transactions/agentMandate';
import { AdminContract } from '../../src/transactions/admin';
import { SweefiPluginConfig } from '../../src/utils/config';
import { ConfigurationError, SweefiErrorCode } from '../../src/utils/errors';

const PACKAGE_ID = '0x' + 'ab'.repeat(32);

// ══════════════════════════════════════════════════════════════
// sweefi() factory
// ══════════════════════════════════════════════════════════════

describe('sweefi() factory', () => {
  it('returns a registration with name and register function', () => {
    const reg = sweefi();
    expect(reg.name).toBe('sweefi');
    expect(typeof reg.register).toBe('function');
  });

  it('supports custom namespace', () => {
    const reg = sweefi({ name: 'payments' });
    expect(reg.name).toBe('payments');
  });

  it('register() returns a SweefiClient with all contract namespaces', () => {
    const reg = sweefi();
    const mockClient = { network: 'testnet' as const } as any;

    const api = reg.register(mockClient);
    expect(api.payment).toBeInstanceOf(PaymentContract);
    expect(api.stream).toBeInstanceOf(StreamContract);
    expect(api.escrow).toBeInstanceOf(EscrowContract);
    expect(api.prepaid).toBeInstanceOf(PrepaidContract);
    expect(api.mandate).toBeInstanceOf(MandateContract);
    expect(api.agentMandate).toBeInstanceOf(AgentMandateContract);
    expect(api.admin).toBeInstanceOf(AdminContract);
  });

  it('auto-fills testnet defaults (verified via config class)', () => {
    // Test config resolution directly — config is private on SweefiClient
    const config = new SweefiPluginConfig({ network: 'testnet' });
    expect(config.packageId).toBeTruthy();
    expect(config.protocolState).toBeTruthy();

    // Verify factory doesn't throw (proves defaults resolved)
    const reg = sweefi();
    const mockClient = { network: 'testnet' as const } as any;
    expect(() => reg.register(mockClient)).not.toThrow();
  });

  it('uses explicit packageId over network defaults', () => {
    // Verify custom packageId flows through via config class
    const config = new SweefiPluginConfig({ packageId: PACKAGE_ID, network: 'testnet' });
    expect(config.packageId).toBe(PACKAGE_ID);
  });

  it('throws ConfigurationError for unknown network without packageId', () => {
    const reg = sweefi();
    const mockClient = { network: 'localnet' as const } as any;

    expect(() => reg.register(mockClient)).toThrow(ConfigurationError);
  });
});

// ══════════════════════════════════════════════════════════════
// SweefiPluginConfig
// ══════════════════════════════════════════════════════════════

describe('SweefiPluginConfig', () => {
  it('resolves testnet defaults', () => {
    const config = new SweefiPluginConfig({ network: 'testnet' });
    expect(config.packageId).toBeTruthy();
    expect(config.protocolState).toBeTruthy();
    expect(config.adminCap).toBeTruthy();
    expect(config.SUI_CLOCK).toBe('0x6');
  });

  it('throws PACKAGE_ID_REQUIRED for unknown network', () => {
    expect(() => new SweefiPluginConfig({ network: 'localnet' }))
      .toThrow(ConfigurationError);

    try {
      new SweefiPluginConfig({ network: 'localnet' });
    } catch (e: any) {
      expect(e.code).toBe(SweefiErrorCode.PACKAGE_ID_REQUIRED);
    }
  });

  it('requireProtocolState throws when not set', () => {
    const config = new SweefiPluginConfig({
      packageId: PACKAGE_ID,
      network: 'localnet',
    });
    expect(() => config.requireProtocolState()).toThrow(ConfigurationError);
  });

  it('requireAdminCap throws when not set', () => {
    const config = new SweefiPluginConfig({
      packageId: PACKAGE_ID,
      network: 'localnet',
    });
    expect(() => config.requireAdminCap()).toThrow(ConfigurationError);
  });

  it('getCoinDecimals returns 9 for SUI', () => {
    const config = new SweefiPluginConfig({ network: 'testnet' });
    expect(config.getCoinDecimals('0x2::sui::SUI')).toBe(9);
  });

  it('getCoinDecimals uses custom config', () => {
    const config = new SweefiPluginConfig({
      network: 'testnet',
      coinTypes: { '0xusdc::usdc::USDC': { decimals: 6 } },
    });
    expect(config.getCoinDecimals('0xusdc::usdc::USDC')).toBe(6);
  });

  it('getCoinDecimals throws for unknown coin', () => {
    const config = new SweefiPluginConfig({ network: 'testnet' });
    expect(() => config.getCoinDecimals('0xunknown::foo::BAR'))
      .toThrow(/Unknown coin decimals/);
  });
});

// ══════════════════════════════════════════════════════════════
// Error hierarchy
// ══════════════════════════════════════════════════════════════

describe('SweefiError hierarchy', () => {
  it('SweefiErrorCode is tree-shakeable const object', () => {
    expect(SweefiErrorCode.PACKAGE_ID_REQUIRED).toBe('PACKAGE_ID_REQUIRED');
    expect(SweefiErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
  });

  it('ConfigurationError has correct prototype chain', () => {
    try {
      new SweefiPluginConfig({ network: 'localnet' });
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConfigurationError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('ConfigurationError');
      expect(e.code).toBe('PACKAGE_ID_REQUIRED');
    }
  });
});
