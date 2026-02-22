/**
 * useSweefiPayment — React hook for the s402 payment flow.
 *
 * Bridges PaymentController (from @sweefi/ui-core) to React's state via
 * useSyncExternalStore, which guarantees tear-free reads during concurrent
 * rendering — no stale state, no waterfall re-renders.
 *
 * Usage (standalone — controller provided at call site):
 *   const { state, pay, confirm, reset } = useSweefiPayment(controller);
 *
 * Usage (context mode — controller injected from SweefiProvider):
 *   <SweefiProvider controller={controller}><YourApp /></SweefiProvider>
 *   // inside any child component:
 *   const { state, pay, confirm, reset } = useSweefiPayment();
 */

import { useCallback, useContext, useRef, useSyncExternalStore } from "react";
import type { PaymentController, PaymentState } from "@sweefi/ui-core";
import type { s402PaymentRequirements } from "s402";
import { SweefiPaymentContext } from "../context.js";

export interface UseSweefiPaymentReturn {
  /** Reactive snapshot of the PaymentController state. */
  state: PaymentState;
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
 * @param controller - Optional explicit controller. When omitted, the hook
 *   reads from SweefiPaymentContext (provided by SweefiProvider). Throws if
 *   neither is available.
 */
export function useSweefiPayment(
  controller?: PaymentController
): UseSweefiPaymentReturn {
  // Always call useContext — React's rules of hooks forbid conditional calls.
  // If `controller` is passed directly it takes precedence over the context value.
  const contextController = useContext(SweefiPaymentContext);
  const ctrl = controller ?? contextController;

  if (!ctrl) {
    throw new Error(
      "useSweefiPayment: no PaymentController found. " +
        "Either pass one directly or wrap with <SweefiProvider controller={controller}>."
    );
  }

  // useSyncExternalStore requires getSnapshot to return a STABLE reference between
  // store changes. PaymentController.getState() returns a new object every call
  // ({ ...this.state }), so we must cache the last snapshot and update it only
  // when the subscribe callback fires — that's the only time state actually changed.
  const snapshotRef = useRef<PaymentState>(ctrl.getState());

  // useSyncExternalStore expects subscribe(onStoreChange: () => void) => unsubscribe.
  // PaymentController.subscribe passes the new state to the callback, so we capture
  // it into snapshotRef and then call notify() so React knows to re-read the snapshot.
  const subscribe = useCallback(
    (notify: () => void) =>
      ctrl.subscribe((newState) => {
        snapshotRef.current = newState;
        notify();
      }),
    [ctrl]
  );

  const state = useSyncExternalStore(subscribe, () => snapshotRef.current);

  const pay = useCallback(
    (url: string, opts?: { requirements?: s402PaymentRequirements }) =>
      ctrl.pay(url, opts),
    [ctrl]
  );
  const confirm = useCallback(() => ctrl.confirm(), [ctrl]);
  const reset = useCallback(() => ctrl.reset(), [ctrl]);

  return { state, pay, confirm, reset };
}
