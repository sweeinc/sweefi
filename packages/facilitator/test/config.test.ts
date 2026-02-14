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
    process.env.API_KEYS = "test-key-1,test-key-2";
    const { loadConfig } = await import("../src/config");
    const config = loadConfig();

    expect(config.PORT).toBe(4022);
    expect(config.API_KEYS).toBe("test-key-1,test-key-2");
    expect(config.FEE_BPS).toBe(50);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("fails without API_KEYS", async () => {
    delete process.env.API_KEYS;
    const { loadConfig } = await import("../src/config");
    expect(() => loadConfig()).toThrow();
  });

  it("accepts custom PORT", async () => {
    process.env.API_KEYS = "key";
    process.env.PORT = "8080";
    const { loadConfig } = await import("../src/config");
    expect(loadConfig().PORT).toBe(8080);
  });

  it("accepts custom FEE_BPS", async () => {
    process.env.API_KEYS = "key";
    process.env.FEE_BPS = "100";
    const { loadConfig } = await import("../src/config");
    expect(loadConfig().FEE_BPS).toBe(100);
  });
});
