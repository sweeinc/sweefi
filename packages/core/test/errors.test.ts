import { describe, it, expect } from 'vitest';
import { SweeError, SweeErrorCode } from '../src/index.js';

describe('SweeError', () => {
  describe('when creating an error', () => {
    it('should carry the error code', () => {
      const err = new SweeError(SweeErrorCode.NETWORK_ERROR, 'Connection failed');
      expect(err.code).toBe(SweeErrorCode.NETWORK_ERROR);
      expect(err.message).toBe('Connection failed');
      expect(err.name).toBe('SweeError');
    });

    it('should chain a cause error', () => {
      const cause = new Error('timeout');
      const err = new SweeError(SweeErrorCode.RPC_TIMEOUT, 'RPC timed out', cause);
      expect(err.cause).toBe(cause);
    });

    it('should be an instance of Error', () => {
      const err = new SweeError(SweeErrorCode.INVALID_ARGUMENT, 'bad input');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SweeError);
    });
  });
});

describe('SweeErrorCode', () => {
  describe('when accessing error codes', () => {
    it('should have all expected network codes', () => {
      expect(SweeErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');
      expect(SweeErrorCode.RPC_TIMEOUT).toBe('RPC_TIMEOUT');
    });

    it('should have all expected SEAL codes', () => {
      expect(SweeErrorCode.SEAL_ENCRYPT_FAILED).toBe('SEAL_ENCRYPT_FAILED');
      expect(SweeErrorCode.SEAL_DECRYPT_FAILED).toBe('SEAL_DECRYPT_FAILED');
      expect(SweeErrorCode.SEAL_SESSION_EXPIRED).toBe('SEAL_SESSION_EXPIRED');
      expect(SweeErrorCode.SEAL_ACCESS_DENIED).toBe('SEAL_ACCESS_DENIED');
    });

    it('should have all expected Walrus codes', () => {
      expect(SweeErrorCode.WALRUS_UPLOAD_FAILED).toBe('WALRUS_UPLOAD_FAILED');
      expect(SweeErrorCode.WALRUS_DOWNLOAD_FAILED).toBe('WALRUS_DOWNLOAD_FAILED');
    });

    it('should have all expected wallet/budget codes', () => {
      expect(SweeErrorCode.WALLET_CREATION_FAILED).toBe('WALLET_CREATION_FAILED');
      expect(SweeErrorCode.INSUFFICIENT_BALANCE).toBe('INSUFFICIENT_BALANCE');
      expect(SweeErrorCode.SPONSORSHIP_FAILED).toBe('SPONSORSHIP_FAILED');
      expect(SweeErrorCode.BUDGET_EXCEEDED).toBe('BUDGET_EXCEEDED');
    });

    it('should have exactly 13 error codes', () => {
      const codeValues = Object.values(SweeErrorCode);
      expect(codeValues.length).toBe(13);
    });
  });
});
