import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("parses valid config with defaults", async () => {
    process.env.API_KEYS = "test-api-key-alpha,test-api-key-beta";
    const { loadConfig } = await import("../src/config");
    const config = loadConfig();

    expect(config.PORT).toBe(4022);
    expect(config.API_KEYS).toBe("test-api-key-alpha,test-api-key-beta");
    expect(config.FEE_MICRO_PERCENT).toBe(5_000);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("fails without API_KEYS", async () => {
    delete process.env.API_KEYS;
    const { loadConfig } = await import("../src/config");
    expect(() => loadConfig()).toThrow();
  });

  it("accepts custom PORT", async () => {
    process.env.API_KEYS = "valid-test-api-key-1";
    process.env.PORT = "8080";
    const { loadConfig } = await import("../src/config");
    expect(loadConfig().PORT).toBe(8080);
  });

  it("accepts custom FEE_MICRO_PERCENT", async () => {
    process.env.API_KEYS = "valid-test-api-key-1";
    process.env.FEE_MICRO_PERCENT = "10000";
    const { loadConfig } = await import("../src/config");
    expect(loadConfig().FEE_MICRO_PERCENT).toBe(10_000);
  });
});
