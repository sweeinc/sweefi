/**
 * Default facilitator URL.
 *
 * Set to empty string — callers MUST provide their own facilitator URL.
 * Self-host with Docker/Fly.io (see packages/facilitator) or use direct settlement.
 * This avoids implicit trust of a third-party facilitator endpoint.
 */
export const DEFAULT_FACILITATOR_URL = "";
