/**
 * s402 Sui Scheme Implementations
 *
 * Six payment schemes + direct settlement:
 *   - Exact: one-shot payment (coinWithBalance → transferObjects)
 *   - Upto: variable-amount deposit (facilitator settles actual usage)
 *   - Prepaid: deposit-based agent budgets (off-chain usage, batch-claim)
 *   - Stream: two-phase protocol (402 setup + X-STREAM-ID header)
 *   - Escrow: time-locked escrow with arbiter
 *   - Unlock: composite escrow + pay-to-decrypt encryption
 *   - Direct: no-facilitator self-settlement
 */

// Exact
export { ExactSuiClientScheme } from './exact/client.js';
export type { ExactSuiClientSchemeConfig } from './exact/client.js';
export { ExactSuiFacilitatorScheme, DEFAULT_MAX_SPONSOR_GAS_BUDGET } from './exact/facilitator.js';

// Stream
export { StreamSuiClientScheme } from './stream/client.js';
export { StreamSuiFacilitatorScheme } from './stream/facilitator.js';
export { StreamSuiServerScheme } from './stream/server.js';

// Escrow
export { EscrowSuiClientScheme } from './escrow/client.js';
export { EscrowSuiFacilitatorScheme } from './escrow/facilitator.js';
export { EscrowSuiServerScheme } from './escrow/server.js';

// Prepaid
export { PrepaidSuiClientScheme } from './prepaid/client.js';
export { PrepaidSuiFacilitatorScheme } from './prepaid/facilitator.js';
export { PrepaidSuiServerScheme } from './prepaid/server.js';

// Upto (variable-amount deposit)
export { UptoSuiClientScheme } from './upto/client.js';
export { UptoSuiFacilitatorScheme } from './upto/facilitator.js';
export { UptoSuiServerScheme } from './upto/server.js';

// Unlock (pay-to-decrypt)
export { UnlockSuiClientScheme } from './unlock/client.js';

// Direct settlement
export { DirectSuiSettlement } from './direct.js';

// S8: Settlement verification (shared helper for all client-signed schemes)
export { verifySuiSettlement } from './verify.js';
