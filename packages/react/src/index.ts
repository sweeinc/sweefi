/**
 * @sweefi/react
 *
 * React hooks and context for the SweeFi s402 payment flow.
 *
 * Quick start:
 *   import { SweefiProvider, useSweefiPayment } from '@sweefi/react';
 *   import { createPaymentController } from '@sweefi/ui-core';
 *   import { SuiPaymentAdapter } from '@sweefi/sui';
 *
 *   const adapter = new SuiPaymentAdapter({ wallet, client, network: 'sui:testnet' });
 *   const controller = createPaymentController(adapter);
 *
 *   // Option A — context (provide to entire sub-tree):
 *   <SweefiProvider controller={controller}><App /></SweefiProvider>
 *   // then in any descendant: const { state, pay, confirm } = useSweefiPayment();
 *
 *   // Option B — standalone (pass controller directly):
 *   const { state, pay, confirm } = useSweefiPayment(controller);
 */

export { SweefiProvider, useSweefiController, SweefiPaymentContext } from "./context.js";
export { useSweefiPayment } from "./hooks/useSweefiPayment.js";
export type { UseSweefiPaymentReturn } from "./hooks/useSweefiPayment.js";
