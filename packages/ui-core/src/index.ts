/**
 * @sweefi/ui-core
 *
 * Framework-agnostic payment state machine and adapter interface.
 * Chain implementations (@sweefi/sui, @sweefi/sol) depend on this package —
 * never the reverse.
 *
 * Usage:
 *   import { createPaymentController } from '@sweefi/ui-core';
 *   import { SuiPaymentAdapter } from '@sweefi/sui';
 *
 *   const adapter = new SuiPaymentAdapter({ wallet: currentWallet });
 *   const controller = createPaymentController(adapter);
 *   await controller.pay('https://api.example.com/resource');
 *   await controller.confirm();
 */

export type {
  PaymentAdapter,
  SimulationResult,
} from "./interfaces/PaymentAdapter.js";

export {
  PaymentController,
  createPaymentController,
} from "./controllers/PaymentController.js";

export type {
  PaymentStatus,
  PaymentState,
} from "./controllers/PaymentController.js";
