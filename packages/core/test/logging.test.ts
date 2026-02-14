import { describe, it, expect, vi } from 'vitest';
import { defaultLogger } from '../src/logging/logger.js';

describe('defaultLogger', () => {
  describe('when logging messages', () => {
    it('should call console.debug for debug level', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      defaultLogger.debug('test debug');
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('should call console.info for info level', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      defaultLogger.info('test info');
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('should call console.warn for warn level', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      defaultLogger.warn('test warn');
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('should call console.error for error level', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      defaultLogger.error('test error');
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('should include context when provided', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      defaultLogger.info('test', { key: 'value' });
      expect(spy).toHaveBeenCalledWith('[swee:info] test', { key: 'value' });
      spy.mockRestore();
    });
  });
});
