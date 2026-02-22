/**
 * useSweefiPayment + SweefiProvider tests
 *
 * Uses mock PaymentAdapter — zero Sui or network dependencies.
 *
 * Testing strategy: renderHook() returns result.current which always reflects
 * the latest hook return value. State is driven via the PaymentController
 * directly; act() ensures React flushes all updates before assertions run.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  createPaymentController,
  type PaymentAdapter,
  type SimulationResult,
} from "@sweefi/ui-core";
import type { s402PaymentRequirements } from "s402";
import { SweefiProvider, useSweefiPayment } from "../src/index";

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const mockReqs: s402PaymentRequirements = {
  s402Version: "1",
  accepts: ["exact"],
  network: "sui:testnet",
  asset: "0x2::sui::SUI",
  amount: "1000",
  payTo: "0x1111",
};

function makeAdapter(overrides?: Partial<PaymentAdapter>): PaymentAdapter {
  return {
    network: "sui:testnet",
    getAddress: vi.fn().mockReturnValue("0xabc"),
    simulate: vi.fn().mockResolvedValue({
      success: true,
      estimatedFee: { amount: 500n, currency: "SUI" },
    } satisfies SimulationResult),
    signAndBroadcast: vi.fn().mockResolvedValue({ txId: "0xdeadbeef" }),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useSweefiPayment", () => {
  describe("initial state", () => {
    it("exposes idle status and wallet address on mount", () => {
      const controller = createPaymentController(makeAdapter());
      const { result } = renderHook(() => useSweefiPayment(controller));

      expect(result.current.state.status).toBe("idle");
      expect(result.current.state.address).toBe("0xabc");
    });
  });

  describe("reactivity", () => {
    it("updates to 'ready' after pay() resolves", async () => {
      const controller = createPaymentController(makeAdapter());
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await controller.pay("https://example.com/api", { requirements: mockReqs });
      });

      expect(result.current.state.status).toBe("ready");
    });

    it("updates to 'settled' with txId after confirm() resolves", async () => {
      const controller = createPaymentController(makeAdapter());
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await controller.pay("https://example.com/api", { requirements: mockReqs });
        await controller.confirm();
      });

      expect(result.current.state.status).toBe("settled");
      expect(result.current.state.txId).toBe("0xdeadbeef");
    });

    it("updates to 'idle' after reset()", async () => {
      const controller = createPaymentController(makeAdapter());
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await controller.pay("https://example.com/api", { requirements: mockReqs });
      });

      act(() => {
        controller.reset();
      });

      expect(result.current.state.status).toBe("idle");
      expect(result.current.state.txId).toBeNull();
    });

    it("updates to 'error' when simulation fails", async () => {
      const controller = createPaymentController(
        makeAdapter({
          simulate: vi.fn().mockResolvedValue({
            success: false,
            error: { code: "INSUFFICIENT_BALANCE", message: "Not enough SUI" },
          } satisfies SimulationResult),
        })
      );
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await controller
          .pay("https://example.com/api", { requirements: mockReqs })
          .catch(() => {});
      });

      expect(result.current.state.status).toBe("error");
      expect(result.current.state.error).toBe("Not enough SUI");
    });
  });

  describe("unsubscribe on unmount", () => {
    it("stops reacting to controller changes after unmount", async () => {
      const controller = createPaymentController(makeAdapter());
      const { result, unmount } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await controller.pay("https://example.com/api", { requirements: mockReqs });
      });
      expect(result.current.state.status).toBe("ready");

      unmount();

      // Controller transitions after unmount should not throw
      controller.reset();
    });
  });

  describe("pay/confirm/reset delegation", () => {
    it("pay() delegates to the controller adapter", async () => {
      const adapter = makeAdapter();
      const controller = createPaymentController(adapter);
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await result.current.pay("https://example.com/api", { requirements: mockReqs });
      });

      expect(adapter.simulate).toHaveBeenCalledWith(mockReqs);
    });

    it("confirm() delegates to the controller adapter", async () => {
      const adapter = makeAdapter();
      const controller = createPaymentController(adapter);
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await result.current.pay("https://example.com/api", { requirements: mockReqs });
        await result.current.confirm();
      });

      expect(adapter.signAndBroadcast).toHaveBeenCalledWith(mockReqs);
    });

    it("reset() delegates to the controller", async () => {
      const adapter = makeAdapter();
      const controller = createPaymentController(adapter);
      const { result } = renderHook(() => useSweefiPayment(controller));

      await act(async () => {
        await result.current.pay("https://example.com/api", { requirements: mockReqs });
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.status).toBe("idle");
    });
  });

  describe("error when no controller", () => {
    it("throws when called without controller and without SweefiProvider", () => {
      expect(() => renderHook(() => useSweefiPayment())).toThrow(
        "no PaymentController found"
      );
    });
  });
});

describe("SweefiProvider", () => {
  it("provides controller to child via context", async () => {
    const controller = createPaymentController(makeAdapter());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SweefiProvider controller={controller}>{children}</SweefiProvider>
    );

    const { result } = renderHook(() => useSweefiPayment(), { wrapper });

    expect(result.current.state.status).toBe("idle");

    await act(async () => {
      await controller.pay("https://example.com/api", { requirements: mockReqs });
    });

    expect(result.current.state.status).toBe("ready");
  });

  it("standalone controller takes precedence over context controller", async () => {
    const contextController = createPaymentController(makeAdapter());
    const standaloneController = createPaymentController(
      makeAdapter({ getAddress: vi.fn().mockReturnValue("0xstandalone") })
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SweefiProvider controller={contextController}>{children}</SweefiProvider>
    );

    const { result } = renderHook(() => useSweefiPayment(standaloneController), {
      wrapper,
    });

    // Should use standalone, not context
    expect(result.current.state.address).toBe("0xstandalone");
  });
});
