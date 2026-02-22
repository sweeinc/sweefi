/**
 * PaymentController tests
 *
 * Migrated + rewritten from packages/widget/test/core-controller.test.ts.
 * All tests use a mock PaymentAdapter — zero Sui dependencies.
 */

import { describe, it, expect, vi } from "vitest";
import {
  PaymentController,
  createPaymentController,
} from "../src/controllers/PaymentController.js";
import type { PaymentAdapter, SimulationResult } from "../src/interfaces/PaymentAdapter.js";
import type { s402PaymentRequirements } from "s402";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
    simulate: vi.fn().mockResolvedValue({ success: true, estimatedFee: { amount: 500n, currency: "SUI" } } satisfies SimulationResult),
    signAndBroadcast: vi.fn().mockResolvedValue({ txId: "0xdeadbeef" }),
    ...overrides,
  };
}

function makeController(overrides?: Partial<PaymentAdapter>): {
  controller: PaymentController;
  adapter: PaymentAdapter;
} {
  const adapter = makeAdapter(overrides);
  return { controller: createPaymentController(adapter), adapter };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PaymentController", () => {
  describe("initial state", () => {
    it("starts idle with the adapter address", () => {
      const { controller } = makeController();
      const state = controller.getState();
      expect(state.status).toBe("idle");
      expect(state.address).toBe("0xabc");
      expect(state.requirements).toBeNull();
      expect(state.txId).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe("pay()", () => {
    it("transitions idle → simulating → ready when requirements are provided", async () => {
      const { controller } = makeController();
      const states: string[] = [];
      controller.subscribe((s) => states.push(s.status));

      await controller.pay("https://example.com/api", { requirements: mockReqs });

      expect(states).toEqual(["simulating", "ready"]);
      expect(controller.getState().status).toBe("ready");
      expect(controller.getState().requirements).toEqual(mockReqs);
    });

    it("transitions through fetching_requirements when no requirements provided", async () => {
      const { controller } = makeController();
      const states: string[] = [];
      controller.subscribe((s) => states.push(s.status));

      // Mock fetch to return a 402
      const mockFetch = vi.fn().mockResolvedValue({
        status: 402,
        json: () => Promise.resolve({ paymentRequirements: [mockReqs] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await controller.pay("https://example.com/api");

      expect(states).toContain("fetching_requirements");
      expect(states).toContain("simulating");
      expect(states).toContain("ready");
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/api");

      vi.unstubAllGlobals();
    });

    it("goes to error when simulation fails", async () => {
      const { controller } = makeController({
        simulate: vi.fn().mockResolvedValue({
          success: false,
          error: { code: "INSUFFICIENT_BALANCE", message: "Not enough SUI" },
        } satisfies SimulationResult),
      });

      await expect(
        controller.pay("https://example.com/api", { requirements: mockReqs })
      ).rejects.toThrow("Not enough SUI");

      const state = controller.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Not enough SUI");
      expect(state.simulation?.success).toBe(false);
    });

    it("throws if called from a non-idle state", async () => {
      const { controller } = makeController();
      await controller.pay("https://example.com/api", { requirements: mockReqs });
      // Now in 'ready' state

      await expect(
        controller.pay("https://example.com/api", { requirements: mockReqs })
      ).rejects.toThrow('Cannot start payment from state "ready"');
    });

    it("goes to error when fetch returns non-402", async () => {
      const { controller } = makeController();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));

      await expect(
        controller.pay("https://example.com/api")
      ).rejects.toThrow("Expected 402");

      expect(controller.getState().status).toBe("error");
      vi.unstubAllGlobals();
    });
  });

  describe("confirm()", () => {
    it("transitions ready → awaiting_signature → broadcasting → settled", async () => {
      const { controller } = makeController();
      const states: string[] = [];
      controller.subscribe((s) => states.push(s.status));

      await controller.pay("https://example.com/api", { requirements: mockReqs });
      states.length = 0; // reset to observe confirm() transitions only

      const result = await controller.confirm();

      expect(states).toEqual(["awaiting_signature", "broadcasting", "settled"]);
      expect(result.txId).toBe("0xdeadbeef");
      expect(controller.getState().txId).toBe("0xdeadbeef");
    });

    it("throws if called before pay()", async () => {
      const { controller } = makeController();
      await expect(controller.confirm()).rejects.toThrow(
        'Cannot confirm payment from state "idle"'
      );
    });

    it("goes to error when signAndBroadcast fails", async () => {
      const { controller } = makeController({
        signAndBroadcast: vi.fn().mockRejectedValue(new Error("User rejected")),
      });

      await controller.pay("https://example.com/api", { requirements: mockReqs });
      await expect(controller.confirm()).rejects.toThrow("User rejected");

      expect(controller.getState().status).toBe("error");
      expect(controller.getState().error).toBe("User rejected");
    });
  });

  describe("reset()", () => {
    it("returns to idle and clears all state", async () => {
      const { controller } = makeController();
      await controller.pay("https://example.com/api", { requirements: mockReqs });
      await controller.confirm();

      controller.reset();
      const state = controller.getState();
      expect(state.status).toBe("idle");
      expect(state.requirements).toBeNull();
      expect(state.simulation).toBeNull();
      expect(state.txId).toBeNull();
      expect(state.error).toBeNull();
    });

    it("allows pay() to be called again after reset", async () => {
      const { controller } = makeController();
      await controller.pay("https://example.com/api", { requirements: mockReqs });
      await controller.confirm();

      controller.reset();
      await expect(
        controller.pay("https://example.com/api", { requirements: mockReqs })
      ).resolves.toBeUndefined();
    });
  });

  describe("subscribe()", () => {
    it("returns an unsubscribe function that stops notifications", async () => {
      const { controller } = makeController();
      const listener = vi.fn();
      const unsubscribe = controller.subscribe(listener);

      await controller.pay("https://example.com/api", { requirements: mockReqs });
      const callCountAfterPay = listener.mock.calls.length;
      expect(callCountAfterPay).toBeGreaterThan(0);

      unsubscribe();
      await controller.confirm();

      // No additional calls after unsubscribe
      expect(listener.mock.calls.length).toBe(callCountAfterPay);
    });

    it("notifies all active subscribers on each transition", async () => {
      const { controller } = makeController();
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      controller.subscribe(listenerA);
      controller.subscribe(listenerB);

      await controller.pay("https://example.com/api", { requirements: mockReqs });

      expect(listenerA.mock.calls.length).toBe(listenerB.mock.calls.length);
    });
  });
});
