/**
 * @sweefi/vue
 *
 * Vue 3 composables and plugin for the SweeFi s402 payment flow.
 *
 * Quick start:
 *   import { SweefiPlugin, useSweefiPayment } from '@sweefi/vue';
 *   import { createPaymentController } from '@sweefi/ui-core';
 *   import { SuiPaymentAdapter } from '@sweefi/sui';
 *
 *   const adapter = new SuiPaymentAdapter({ wallet, client, network: 'sui:testnet' });
 *   const controller = createPaymentController(adapter);
 *
 *   // Option A — plugin (provide to entire app):
 *   app.use(SweefiPlugin, controller);
 *   // then in any component: const { state, pay, confirm } = useSweefiPayment();
 *
 *   // Option B — standalone (pass controller directly):
 *   const { state, pay, confirm } = useSweefiPayment(controller);
 */

export { SweefiPlugin, useSweefiController, SWEEFI_CONTROLLER_KEY } from "./plugin.js";
export { useSweefiPayment } from "./composables/useSweefiPayment.js";
export type { UseSweefiPaymentReturn } from "./composables/useSweefiPayment.js";
