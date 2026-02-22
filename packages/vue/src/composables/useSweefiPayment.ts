/**
 * useSweefiPayment — Vue 3 composable for the s402 payment flow.
 *
 * Bridges PaymentController (from @sweefi/ui-core) to Vue's reactivity system.
 * The composable subscribes to controller state on mount and automatically
 * unsubscribes on unmount — no manual cleanup needed.
 *
 * Usage (standalone — controller provided at call site):
 *   const { state, pay, confirm, reset } = useSweefiPayment(controller);
 *
 * Usage (plugin mode — controller injected from SweefiPlugin):
 *   app.use(SweefiPlugin, controller);
 *   // inside any child component:
 *   const { state, pay, confirm, reset } = useSweefiPayment();
 */

import { ref, inject, onScopeDispose } from "vue";
import type { Ref } from "vue";
import type { PaymentController, PaymentState } from "@sweefi/ui-core";
import type { s402PaymentRequirements } from "s402";
import { SWEEFI_CONTROLLER_KEY } from "../plugin.js";

export interface UseSweefiPaymentReturn {
  /** Reactive snapshot of the PaymentController state. */
  state: Ref<PaymentState>;
  /**
   * Phase 1: fetch requirements (if needed) and simulate.
   * Stops at `ready` — call `confirm()` to actually spend funds.
   */
  pay(targetUrl: string, options?: { requirements?: s402PaymentRequirements }): Promise<void>;
  /** Phase 2: sign and broadcast. Must be called after `pay()` resolves. */
  confirm(): Promise<{ txId: string }>;
  /** Reset to idle so `pay()` can be called again. */
  reset(): void;
}

/**
 * @param controller - Optional explicit controller. When omitted, the composable
 *   injects the controller provided by SweefiPlugin. Throws if neither is available.
 */
export function useSweefiPayment(
  controller?: PaymentController
): UseSweefiPaymentReturn {
  const ctrl = controller ?? inject<PaymentController>(SWEEFI_CONTROLLER_KEY);

  if (!ctrl) {
    throw new Error(
      "useSweefiPayment: no PaymentController found. " +
        "Either pass one directly or install SweefiPlugin before using this composable."
    );
  }

  const state = ref<PaymentState>(ctrl.getState());

  const unsubscribe = ctrl.subscribe((s) => {
    state.value = s;
  });

  // Clean up the subscription when the scope is disposed — works in component setup,
  // Pinia stores, and effectScope() contexts. onUnmounted would only fire in component
  // setup and would warn (and leak) when called from a non-component scope.
  onScopeDispose(unsubscribe);

  return {
    state,
    pay: (url, opts) => ctrl.pay(url, opts),
    confirm: () => ctrl.confirm(),
    reset: () => ctrl.reset(),
  };
}
