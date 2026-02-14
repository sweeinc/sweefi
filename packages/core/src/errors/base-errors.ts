import { SweeErrorCode } from './error-codes.js';

/**
 * Base error class for the Swee ecosystem.
 * Carries a typed error code and optional cause for structured error handling.
 */
export class SweeError extends Error {
  readonly code: SweeErrorCode;
  readonly cause?: Error;

  constructor(code: SweeErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = 'SweeError';
    this.code = code;
    this.cause = cause;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
