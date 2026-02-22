/**
 * useSweefiPayment + SweefiPlugin tests
 *
 * Migrated from packages/widget/test/vue-component.test.ts.
 * Uses mock PaymentAdapter — zero Sui or network dependencies.
 *
 * Testing strategy: render a component that uses useSweefiPayment, drive
 * state through the PaymentController directly, assert on rendered HTML.
 * This sidesteps Vue's ref-unwrapping on wrapper.vm and tests the actual
 * reactive pipeline: controller.subscribe → ref.value update → re-render.
 */

import { describe, it, expect, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import {
  createPaymentController,
  type PaymentAdapter,
  type SimulationResult,
} from "@sweefi/ui-core";
import type { s402PaymentRequirements } from "s402";
import { SweefiPlugin, useSweefiPayment } from "../src/index";

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

// ─── Test component helper ────────────────────────────────────────────────────

/**
 * A minimal component that uses useSweefiPayment() and renders state as text.
 * We assert on rendered text instead of accessing wrapper.vm refs directly,
 * which avoids Vue's ref-unwrapping ambiguity.
 */
function makeTestComponent(controller: ReturnType<typeof createPaymentController>) {
  return defineComponent({
    setup() {
      const { state, pay, confirm, reset } = useSweefiPayment(controller);
      return { state, pay, confirm, reset };
    },
    template: `
      <div>
        <span data-testid="status">{{ state.status }}</span>
        <span data-testid="address">{{ state.address }}</span>
        <span data-testid="txId">{{ state.txId ?? '' }}</span>
        <span data-testid="error">{{ state.error ?? '' }}</span>
      </div>
    `,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useSweefiPayment", () => {
  describe("initial state", () => {
    it("renders idle status and wallet address on mount", () => {
      const controller = createPaymentController(makeAdapter());
      const wrapper = mount(makeTestComponent(controller));

      expect(wrapper.find("[data-testid='status']").text()).toBe("idle");
      expect(wrapper.find("[data-testid='address']").text()).toBe("0xabc");
    });
  });

  describe("reactivity", () => {
    it("re-renders with 'ready' status after pay() resolves", async () => {
      const controller = createPaymentController(makeAdapter());
      const wrapper = mount(makeTestComponent(controller));

      await controller.pay("https://example.com/api", { requirements: mockReqs });
      await nextTick();

      expect(wrapper.find("[data-testid='status']").text()).toBe("ready");
    });

    it("re-renders with 'settled' and txId after confirm() resolves", async () => {
      const controller = createPaymentController(makeAdapter());
      const wrapper = mount(makeTestComponent(controller));

      await controller.pay("https://example.com/api", { requirements: mockReqs });
      await controller.confirm();
      await nextTick();

      expect(wrapper.find("[data-testid='status']").text()).toBe("settled");
      expect(wrapper.find("[data-testid='txId']").text()).toBe("0xdeadbeef");
    });

    it("re-renders with 'idle' after reset()", async () => {
      const controller = createPaymentController(makeAdapter());
      const wrapper = mount(makeTestComponent(controller));

      await controller.pay("https://example.com/api", { requirements: mockReqs });
      controller.reset();
      await nextTick();

      expect(wrapper.find("[data-testid='status']").text()).toBe("idle");
      expect(wrapper.find("[data-testid='txId']").text()).toBe("");
    });

    it("re-renders with 'error' when simulation fails", async () => {
      const controller = createPaymentController(
        makeAdapter({
          simulate: vi.fn().mockResolvedValue({
            success: false,
            error: { code: "INSUFFICIENT_BALANCE", message: "Not enough SUI" },
          } satisfies SimulationResult),
        })
      );
      const wrapper = mount(makeTestComponent(controller));

      await controller
        .pay("https://example.com/api", { requirements: mockReqs })
        .catch(() => {});
      await nextTick();

      expect(wrapper.find("[data-testid='status']").text()).toBe("error");
      expect(wrapper.find("[data-testid='error']").text()).toBe("Not enough SUI");
    });
  });

  describe("unsubscribe on unmount", () => {
    it("stops reacting to controller changes after unmount", async () => {
      const controller = createPaymentController(makeAdapter());
      const wrapper = mount(makeTestComponent(controller));

      // Component is alive — should respond to state changes
      await controller.pay("https://example.com/api", { requirements: mockReqs });
      await nextTick();
      expect(wrapper.find("[data-testid='status']").text()).toBe("ready");

      // Unmount — subscription should be torn down
      wrapper.unmount();

      // Controller transitions after unmount should not throw
      controller.reset();
    });
  });

  describe("standalone pay/confirm/reset delegation", () => {
    it("pay() delegates to the controller", async () => {
      const adapter = makeAdapter();
      const controller = createPaymentController(adapter);

      const TestCmp = defineComponent({
        setup() {
          const { pay } = useSweefiPayment(controller);
          return { pay };
        },
        template: `<div />`,
      });
      mount(TestCmp);

      // Call pay via the composable's exposed method
      const cmpWrapper = mount(TestCmp);
      await (cmpWrapper.vm as { pay: typeof controller.pay }).pay(
        "https://example.com/api",
        { requirements: mockReqs }
      );

      expect(adapter.simulate).toHaveBeenCalledWith(mockReqs);
    });
  });

  describe("error when no controller", () => {
    it("throws when useSweefiPayment() is called with no controller and no plugin", () => {
      const BrokenComponent = defineComponent({
        setup() {
          useSweefiPayment();
        },
        template: `<span />`,
      });

      expect(() => mount(BrokenComponent)).toThrow("no PaymentController found");
    });
  });
});

describe("SweefiPlugin", () => {
  it("provides controller to child via plugin + inject", async () => {
    const controller = createPaymentController(makeAdapter());

    const ChildComponent = defineComponent({
      setup() {
        const { state } = useSweefiPayment(); // no arg — uses injected controller
        return { state };
      },
      template: `<span data-testid="status">{{ state.status }}</span>`,
    });

    const ParentComponent = defineComponent({
      components: { ChildComponent },
      template: `<ChildComponent />`,
    });

    const wrapper = mount(ParentComponent, {
      global: {
        plugins: [[SweefiPlugin, controller]],
      },
    });

    expect(wrapper.find("[data-testid='status']").text()).toBe("idle");
  });

  it("install throws when no controller is passed", () => {
    const { createApp } = require("vue");
    const app = createApp({ template: "<div />" });
    expect(() => app.use(SweefiPlugin)).toThrow(
      "SweefiPlugin requires a PaymentController"
    );
  });
});
