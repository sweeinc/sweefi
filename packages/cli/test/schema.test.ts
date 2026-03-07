import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schema } from "../src/commands/schema";
import { VERSION } from "../src/output";

describe("schema command", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("emits valid JSON", () => {
    schema();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toBeDefined();
  });

  it("includes cli name and version", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(parsed.cli).toBe("sweefi");
    expect(parsed.version).toBe(VERSION);
  });

  it("includes all commands", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const names = parsed.commands.map((c: { name: string }) => c.name);
    expect(names).toContain("pay");
    expect(names).toContain("pay-402");
    expect(names).toContain("balance");
    expect(names).toContain("receipt");
    expect(names).toContain("prepaid deposit");
    expect(names).toContain("mandate create");
    expect(names).toContain("doctor");
    expect(names).toContain("schema");
    expect(names).toContain("wallet generate");
  });

  it("pay command has idempotency-key flag", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const pay = parsed.commands.find((c: { name: string }) => c.name === "pay");
    const idempotencyFlag = pay.flags.find((f: { name: string }) => f.name === "idempotency-key");
    expect(idempotencyFlag).toBeDefined();
    expect(idempotencyFlag.required).toBe(false);
    expect(idempotencyFlag.requiredWhen).toBeDefined();
  });

  it("pay-402 command has idempotency-key flag", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const pay402 = parsed.commands.find((c: { name: string }) => c.name === "pay-402");
    const idempotencyFlag = pay402.flags.find((f: { name: string }) => f.name === "idempotency-key");
    expect(idempotencyFlag).toBeDefined();
    expect(idempotencyFlag.required).toBe(false);
    expect(idempotencyFlag.requiredWhen).toBeDefined();
  });

  it("every command has name and description", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    for (const cmd of parsed.commands) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it("every arg has name, type, required, description", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    for (const cmd of parsed.commands) {
      for (const arg of cmd.args) {
        expect(typeof arg.name).toBe("string");
        expect(typeof arg.type).toBe("string");
        expect(typeof arg.required).toBe("boolean");
        expect(typeof arg.description).toBe("string");
      }
    }
  });

  it("includes globalFlags with network, human, timeout, verbose", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(parsed.globalFlags).toBeDefined();
    expect(Array.isArray(parsed.globalFlags)).toBe(true);
    const names = parsed.globalFlags.map((f: { name: string }) => f.name);
    expect(names).toContain("network");
    expect(names).toContain("human");
    expect(names).toContain("timeout");
    expect(names).toContain("verbose");
  });

  it("timeout global flag has numeric default", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const timeoutFlag = parsed.globalFlags.find((f: { name: string }) => f.name === "timeout");
    expect(timeoutFlag.type).toBe("number");
    expect(timeoutFlag.default).toBe(30000);
  });

  it("includes envVars section", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(parsed.envVars).toBeDefined();
    const names = parsed.envVars.map((e: { name: string }) => e.name);
    expect(names).toContain("SUI_PRIVATE_KEY");
    expect(names).toContain("SUI_NETWORK");
    expect(names).toContain("SUI_RPC_URL");
  });

  it("SUI_PRIVATE_KEY is marked required", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const key = parsed.envVars.find((e: { name: string }) => e.name === "SUI_PRIVATE_KEY");
    expect(key.required).toBe(true);
  });

  it("includes errorCodes catalog", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(parsed.errorCodes).toBeDefined();
    expect(parsed.errorCodes.length).toBeGreaterThan(20);
  });

  it("every error code has code, retryable, description", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    for (const err of parsed.errorCodes) {
      expect(typeof err.code).toBe("string");
      expect(typeof err.retryable).toBe("boolean");
      expect(typeof err.description).toBe("string");
    }
  });

  it("retryable errors include TX_OUT_OF_GAS, TX_OBJECT_CONFLICT, NETWORK_ERROR, TIMEOUT", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const retryable = parsed.errorCodes.filter((e: { retryable: boolean }) => e.retryable);
    const codes = retryable.map((e: { code: string }) => e.code);
    expect(codes).toContain("TX_OUT_OF_GAS");
    expect(codes).toContain("TX_OBJECT_CONFLICT");
    expect(codes).toContain("NETWORK_ERROR");
    expect(codes).toContain("TIMEOUT");
  });

  it("human-required errors are marked", () => {
    schema();
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    const humanRequired = parsed.errorCodes.filter((e: { requiresHuman?: boolean }) => e.requiresHuman);
    const codes = humanRequired.map((e: { code: string }) => e.code);
    expect(codes).toContain("MANDATE_EXPIRED");
    expect(codes).toContain("MANDATE_TOTAL_EXCEEDED");
    expect(codes).toContain("MANDATE_REVOKED");
  });
});
