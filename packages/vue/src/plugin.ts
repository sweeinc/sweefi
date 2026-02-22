/**
 * SweefiPlugin — Vue 3 plugin for app-level PaymentController injection.
 *
 * Install once at the root:
 *   const controller = createPaymentController(new SuiPaymentAdapter(...));
 *   app.use(SweefiPlugin, controller);
 *
 * Then any component can call useSweefiPayment() without passing the controller.
 */

import type { App, InjectionKey } from "vue";
import { inject } from "vue";
import type { PaymentController } from "@sweefi/ui-core";

/** InjectionKey used by SweefiPlugin and useSweefiPayment(). */
export const SWEEFI_CONTROLLER_KEY: InjectionKey<PaymentController> =
  Symbol("sweefi:controller");

export const SweefiPlugin = {
  install(app: App, controller: PaymentController): void {
    if (!controller) {
      throw new Error(
        "SweefiPlugin requires a PaymentController. " +
          "Pass one as the second argument: app.use(SweefiPlugin, controller)"
      );
    }
    app.provide(SWEEFI_CONTROLLER_KEY, controller);
  },
};

/**
 * Inject the PaymentController provided by SweefiPlugin.
 * Throws if SweefiPlugin has not been installed.
 */
export function useSweefiController(): PaymentController {
  const controller = inject(SWEEFI_CONTROLLER_KEY);
  if (!controller) {
    throw new Error(
      "useSweefiController: SweefiPlugin is not installed on this app. " +
        "Call app.use(SweefiPlugin, controller) before using this function."
    );
  }
  return controller;
}
