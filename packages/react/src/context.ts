/**
 * SweefiProvider — React context for app-level PaymentController injection.
 *
 * Wrap your app (or sub-tree) once at the root:
 *   const controller = createPaymentController(new SuiPaymentAdapter(...));
 *   <SweefiProvider controller={controller}><App /></SweefiProvider>
 *
 * Then any child component can call useSweefiPayment() without passing the controller.
 */

import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { PaymentController } from "@sweefi/ui-core";

/** The context used by SweefiProvider and useSweefiPayment(). */
export const SweefiPaymentContext = createContext<PaymentController | null>(null);

/**
 * Provider component — makes a PaymentController available to all descendants.
 */
export function SweefiProvider({
  controller,
  children,
}: {
  controller: PaymentController;
  children: ReactNode;
}) {
  return createElement(SweefiPaymentContext.Provider, { value: controller }, children);
}

/**
 * Inject the PaymentController provided by SweefiProvider.
 * Throws if SweefiProvider has not been mounted above this component.
 */
export function useSweefiController(): PaymentController {
  const controller = useContext(SweefiPaymentContext);
  if (!controller) {
    throw new Error(
      "useSweefiController: SweefiProvider is not mounted. " +
        "Wrap your component tree with <SweefiProvider controller={controller}>."
    );
  }
  return controller;
}
