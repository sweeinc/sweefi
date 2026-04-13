/** Stable error codes for programmatic handling (MCP, server, CLI consumers).
 *  Const object + type union instead of enum — tree-shakes, no runtime object, isolatedModules-safe. */
export const SweefiErrorCode = {
  PACKAGE_ID_REQUIRED: 'PACKAGE_ID_REQUIRED',
  ADMIN_CAP_NOT_SET: 'ADMIN_CAP_NOT_SET',
  PROTOCOL_STATE_NOT_SET: 'PROTOCOL_STATE_NOT_SET',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  INVALID_COIN_TYPE: 'INVALID_COIN_TYPE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EXTENSION_FAILED: 'EXTENSION_FAILED',
} as const;
export type SweefiErrorCode = typeof SweefiErrorCode[keyof typeof SweefiErrorCode];

export const ErrorMessages: Record<string, string> = {
  [SweefiErrorCode.PACKAGE_ID_REQUIRED]: 'packageId is required for custom networks (auto-fills for testnet/mainnet)',
  [SweefiErrorCode.ADMIN_CAP_NOT_SET]: 'adminCap not configured — required for admin operations',
  [SweefiErrorCode.PROTOCOL_STATE_NOT_SET]: 'protocolState not configured — required for stream/escrow/prepaid',
};

export class SweefiError extends Error {
  readonly code: SweefiErrorCode;
  constructor(code: SweefiErrorCode, message: string) {
    super(message);
    this.name = 'SweefiError';
    this.code = code;
  }
}

export class ResourceNotFoundError extends SweefiError {
  constructor(resourceType: string, id: string) {
    super(SweefiErrorCode.RESOURCE_NOT_FOUND, `${resourceType} not found: ${id}`);
    this.name = 'ResourceNotFoundError';
  }
}

export class ConfigurationError extends SweefiError {
  constructor(code: SweefiErrorCode, message: string) {
    super(code, message);
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends SweefiError {
  constructor(message: string) {
    super(SweefiErrorCode.VALIDATION_FAILED, message);
    this.name = 'ValidationError';
  }
}
