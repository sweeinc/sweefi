/**
 * @sweefi/ui-core — PaymentController
 *
 * Framework-agnostic state machine for the s402 payment flow.
 * Designed to be consumed by @sweefi/vue (via provide/inject + composables)
 * and @sweefi/react (via useSyncExternalStore).
 *
 * SSR SAFE: This module never accesses window, document, localStorage,
 * or any DOM global. Safe to import in Next.js / Nuxt.js server contexts.
 */

import type { s402PaymentRequirements } from "s402";
import type { PaymentAdapter, SimulationResult } from "../interfaces/PaymentAdapter.js";

// ─── State ───────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | "idle"
  | "fetching_requirements"
  | "simulating"
  | "ready"
  | "awaiting_signature"
  | "broadcasting"
  | "settled"
  | "error";

export interface PaymentState {
  status: PaymentStatus;
  /** The connected wallet address from the injected adapter. */
  address: string | null;
  /** Payment requirements received from the 402 response. */
  requirements: s402PaymentRequirements | null;
  /** Result of the last simulation. */
  simulation: SimulationResult | null;
  /** Transaction ID after successful settlement. */
  txId: string | null;
  /** Human-readable error message when status === 'error'. */
  error: string | null;
}

// ─── Controller ──────────────────────────────────────────────────────────────

export class PaymentController {
  private readonly adapter: PaymentAdapter;
  private state: PaymentState;
  private readonly listeners = new Set<(state: PaymentState) => void>();

  constructor(adapter: PaymentAdapter) {
    this.adapter = adapter;
    this.state = {
      status: "idle",
      address: adapter.getAddress(),
      requirements: null,
      simulation: null,
      txId: null,
      error: null,
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Snapshot of current state. Safe to call at any time. */
  getState(): PaymentState {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes.
   * @returns An unsubscribe function — call it to stop receiving updates.
   *
   * Compatible with React's `useSyncExternalStore`:
   *   useSyncExternalStore(controller.subscribe, controller.getState)
   */
  subscribe(listener: (state: PaymentState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Phase 1 — Fetch requirements and simulate.
   * Transitions: idle → fetching_requirements → simulating → ready
   *
   * Stops at `ready` so the UI can show a confirmation step before funds move.
   * Call `confirm()` to proceed.
   *
   * @param targetUrl - The s402-protected endpoint. A GET request is made;
   *   the controller expects a 402 response containing paymentRequirements.
   * @param options.requirements - Skip the fetch step by providing requirements
   *   directly (useful in tests or when the caller already has the 402 payload).
   */
  async pay(
    targetUrl: string,
    options?: { requirements?: s402PaymentRequirements }
  ): Promise<void> {
    if (this.state.status !== "idle") {
      throw new Error(
        `Cannot start payment from state "${this.state.status}". Call reset() first.`
      );
    }

    // Track whether the simulation failure path already set error state,
    // so the outer catch doesn't overwrite the typed SimulationResult.
    let handledError = false;

    try {
      let reqs = options?.requirements;

      if (!reqs) {
        this.setState({ status: "fetching_requirements", error: null });
        reqs = await this.fetchRequirements(targetUrl);
      }

      this.setState({ status: "simulating", requirements: reqs, error: null });
      const simulation = await this.adapter.simulate(reqs);

      if (!simulation.success) {
        handledError = true;
        const msg = simulation.error?.message ?? "Simulation failed";
        this.setState({ status: "error", simulation, error: msg });
        throw new Error(msg);
      }

      this.setState({ status: "ready", simulation });
    } catch (err) {
      if (!handledError) {
        this.setState({ status: "error", error: errorMessage(err) });
      }
      throw err;
    }
  }

  /**
   * Phase 2 — Sign and broadcast.
   * Transitions: ready → awaiting_signature → broadcasting → settled
   *
   * Must be called after `pay()` resolves and the user has confirmed.
   * `awaiting_signature` is set before the adapter call so the UI can
   * show "approve in your wallet" while the wallet extension is open.
   */
  async confirm(): Promise<{ txId: string }> {
    if (this.state.status !== "ready") {
      throw new Error(
        `Cannot confirm payment from state "${this.state.status}". Call pay() first.`
      );
    }

    const reqs = this.state.requirements!;

    try {
      // Signal wallet is open and waiting for user approval
      this.setState({ status: "awaiting_signature" });

      // Set broadcasting BEFORE the call so the UI actually observes this state
      // during the network round-trip. signAndBroadcast is atomic (sign + submit),
      // so this represents "wallet approved, submitting to network" — the work
      // that is happening while we await.
      this.setState({ status: "broadcasting" });
      const { txId } = await this.adapter.signAndBroadcast(reqs);

      this.setState({ status: "settled", txId });
      return { txId };
    } catch (err) {
      this.setState({ status: "error", error: errorMessage(err) });
      throw err;
    }
  }

  /** Reset to idle so `pay()` can be called again. */
  reset(): void {
    this.setState({
      status: "idle",
      address: this.adapter.getAddress(),
      requirements: null,
      simulation: null,
      txId: null,
      error: null,
    });
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private setState(patch: Partial<PaymentState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      // Isolate each listener — one throwing subscriber must not prevent the rest
      // from receiving the state update (e.g., React error boundary in one component
      // should not silence the Vue composable in another).
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[sweefi/ui-core] PaymentController: subscriber threw:", err);
      }
    }
  }

  /**
   * Fetch s402 payment requirements from a protected endpoint.
   * Expects a 402 response with a JSON body containing `paymentRequirements`.
   */
  private async fetchRequirements(
    targetUrl: string
  ): Promise<s402PaymentRequirements> {
    const response = await fetch(targetUrl);

    if (response.status !== 402) {
      throw new Error(
        `Expected 402 from ${targetUrl}, got ${response.status}. ` +
          "Is this endpoint protected with s402Gate?"
      );
    }

    const body = (await response.json()) as {
      paymentRequirements?: s402PaymentRequirements[];
    };

    const reqs = body.paymentRequirements?.[0];
    if (!reqs) {
      throw new Error(
        `No paymentRequirements found in 402 response from ${targetUrl}`
      );
    }

    return reqs;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Convenience factory — equivalent to `new PaymentController(adapter)`. */
export function createPaymentController(adapter: PaymentAdapter): PaymentController {
  return new PaymentController(adapter);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
