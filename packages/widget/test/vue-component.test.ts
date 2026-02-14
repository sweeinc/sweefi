import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { SweepayCheckout } from "../src/vue";

describe("SweepayCheckout (Vue adapter)", () => {
  it("emits connected event when connect button is clicked", async () => {
    const wallet = {
      connect: vi.fn().mockResolvedValue("0xabc"),
      getAddress: vi.fn().mockReturnValue(null as string | null),
      signAndExecuteTransaction: vi.fn(),
    };

    const wrapper = mount(SweepayCheckout, {
      props: {
        wallet,
        recipient: "0x1111",
        amount: "1000",
      },
    });

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await Promise.resolve();

    const connected = wrapper.emitted("connected");
    expect(connected).toBeTruthy();
    expect(connected?.[0]?.[0]).toEqual({ address: "0xabc" });
  });
});
