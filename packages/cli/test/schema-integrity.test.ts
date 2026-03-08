/**
 * Schema integrity tests — Agent A (A1, A3, A4).
 *
 * These tests prove that schema.ts is the single source of truth.
 * If a flag is added to a command but not the schema (or vice versa),
 * the corresponding test here WILL fail.
 *
 * A1: Schema ↔ Code cross-reference — command names, args, flags, defaults
 * A3: Error code completeness — every CliError code in source is in the catalog
 * A4: Global flags consistency — all global flags wired through to commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schema } from "../src/commands/schema";
import { CliError } from "../src/context";
import { createRequestContext } from "../src/output";

// ─── Helpers ────────────────────────────────────────────────────

interface ArgDef { name: string; type: string; required: boolean; description: string; }
interface FlagDef { name: string; type: string; required?: boolean; requiredWhen?: string; default?: unknown; description: string; }
interface ErrorCodeDef { code: string; retryable: boolean; requiresHuman?: boolean; description: string; }
interface CommandDef { name: string; description: string; args: ArgDef[]; flags: FlagDef[]; }
interface ParsedSchema {
  cli: string;
  version: string;
  globalFlags: FlagDef[];
  envVars: { name: string; required: boolean; description: string }[];
  commands: CommandDef[];
  errorCodes: ErrorCodeDef[];
}

function createMockContext() {
  return {
    suiClient: {
      getBalance: vi.fn(),
      getObject: vi.fn(),
      getOwnedObjects: vi.fn(),
      getRpcApiVersion: vi.fn(),
      devInspectTransactionBlock: vi.fn(),
      signAndExecuteTransaction: vi.fn(),
    } as unknown as import("../src/context").CliContext["suiClient"],
    signer: null,
    config: { packageId: "0xTEST_PACKAGE", protocolStateId: "0xTEST_STATE" },
    network: "testnet" as const,
    verbose: false,
    timeoutMs: 30_000,
  };
}

function captureSchemaOutput(): ParsedSchema {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  });
  schema();
  spy.mockRestore();
  return JSON.parse(output) as ParsedSchema;
}

const VALID_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001";

// ─── A1: Schema command completeness ────────────────────────────

describe("A1: Schema command completeness", () => {
  let s: ParsedSchema;

  beforeEach(() => { s = captureSchemaOutput(); });

  it("schema has exactly 13 commands — no missing, no extras", () => {
    const names = s.commands.map((c) => c.name).sort();
    expect(names).toEqual([
      "balance",
      "doctor",
      "mandate check",
      "mandate create",
      "mandate list",
      "pay",
      "pay-402",
      "prepaid deposit",
      "prepaid list",
      "prepaid status",
      "receipt",
      "schema",
      "wallet generate",
    ]);
  });

  it("every command has non-empty name and description", () => {
    for (const cmd of s.commands) {
      expect(cmd.name.length, `${cmd.name}: name empty`).toBeGreaterThan(0);
      expect(cmd.description.length, `${cmd.name}: description empty`).toBeGreaterThan(0);
    }
  });
});

// ─── A1: Schema flag cross-reference ────────────────────────────

describe("A1: Per-command flag cross-reference", () => {
  let s: ParsedSchema;

  beforeEach(() => { s = captureSchemaOutput(); });

  function flagNames(cmdName: string): string[] {
    const cmd = s.commands.find((c) => c.name === cmdName);
    if (!cmd) throw new Error(`Command "${cmdName}" not found in schema`);
    return cmd.flags.map((f) => f.name).sort();
  }

  function argNames(cmdName: string): string[] {
    const cmd = s.commands.find((c) => c.name === cmdName);
    if (!cmd) throw new Error(`Command "${cmdName}" not found in schema`);
    return cmd.args.map((a) => a.name).sort();
  }

  it("pay: exact arg set matches code (recipient, amount)", () => {
    expect(argNames("pay")).toEqual(["amount", "recipient"]);
  });

  it("pay: exact flag set matches code", () => {
    expect(flagNames("pay")).toEqual(
      ["coin", "dry-run", "idempotency-key", "mandate", "memo", "registry"].sort(),
    );
  });

  it("pay: idempotency-key is not required but has requiredWhen set", () => {
    const cmd = s.commands.find((c) => c.name === "pay")!;
    const idemFlag = cmd.flags.find((f) => f.name === "idempotency-key")!;
    expect(idemFlag.required).toBe(false);
    expect(idemFlag.requiredWhen).toBeDefined();
    expect(idemFlag.requiredWhen!.length).toBeGreaterThan(0);
  });

  it("pay: dry-run default is false", () => {
    const cmd = s.commands.find((c) => c.name === "pay")!;
    const dryRun = cmd.flags.find((f) => f.name === "dry-run")!;
    expect(dryRun.default).toBe(false);
  });

  it("pay-402: no positional args (--url is a flag, not positional)", () => {
    expect(argNames("pay-402")).toEqual([]);
  });

  it("pay-402: exact flag set matches code", () => {
    expect(flagNames("pay-402")).toEqual(
      ["body", "dry-run", "header", "idempotency-key", "method", "url"].sort(),
    );
  });

  it("pay-402: url flag is required", () => {
    const cmd = s.commands.find((c) => c.name === "pay-402")!;
    const urlFlag = cmd.flags.find((f) => f.name === "url")!;
    expect(urlFlag.required).toBe(true);
  });

  it("pay-402: method default is GET", () => {
    const cmd = s.commands.find((c) => c.name === "pay-402")!;
    const methodFlag = cmd.flags.find((f) => f.name === "method")!;
    expect(methodFlag.default).toBe("GET");
  });

  it("balance: optional address arg, coin flag only", () => {
    expect(argNames("balance")).toEqual(["address"]);
    expect(flagNames("balance")).toEqual(["coin"]);
    const cmd = s.commands.find((c) => c.name === "balance")!;
    const addrArg = cmd.args.find((a) => a.name === "address")!;
    expect(addrArg.required).toBe(false);
  });

  it("receipt: required object-id arg, no flags", () => {
    expect(argNames("receipt")).toEqual(["object-id"]);
    expect(flagNames("receipt")).toEqual([]);
    const cmd = s.commands.find((c) => c.name === "receipt")!;
    const idArg = cmd.args.find((a) => a.name === "object-id")!;
    expect(idArg.required).toBe(true);
  });

  it("prepaid deposit: 2 required args, 4 flags", () => {
    expect(argNames("prepaid deposit")).toEqual(["amount", "provider"]);
    expect(flagNames("prepaid deposit")).toEqual(["coin", "dry-run", "max-calls", "rate"].sort());
    const cmd = s.commands.find((c) => c.name === "prepaid deposit")!;
    for (const arg of cmd.args) {
      expect(arg.required, `prepaid deposit: ${arg.name} should be required`).toBe(true);
    }
  });

  it("prepaid status: required balance-id arg, no flags", () => {
    expect(argNames("prepaid status")).toEqual(["balance-id"]);
    expect(flagNames("prepaid status")).toEqual([]);
    const cmd = s.commands.find((c) => c.name === "prepaid status")!;
    expect(cmd.args[0].required).toBe(true);
  });

  it("prepaid list: optional address arg, no flags", () => {
    expect(argNames("prepaid list")).toEqual(["address"]);
    expect(flagNames("prepaid list")).toEqual([]);
    const cmd = s.commands.find((c) => c.name === "prepaid list")!;
    expect(cmd.args[0].required).toBe(false);
  });

  it("mandate create: 4 required args, 2 flags", () => {
    expect(argNames("mandate create")).toEqual(
      ["agent", "expires-in", "max-per-tx", "max-total"].sort(),
    );
    expect(flagNames("mandate create")).toEqual(["coin", "dry-run"].sort());
    const cmd = s.commands.find((c) => c.name === "mandate create")!;
    for (const arg of cmd.args) {
      expect(arg.required, `mandate create: ${arg.name} should be required`).toBe(true);
    }
  });

  it("mandate check: required mandate-id arg, no flags", () => {
    expect(argNames("mandate check")).toEqual(["mandate-id"]);
    expect(flagNames("mandate check")).toEqual([]);
    const cmd = s.commands.find((c) => c.name === "mandate check")!;
    expect(cmd.args[0].required).toBe(true);
  });

  it("mandate list: optional address arg, no flags", () => {
    expect(argNames("mandate list")).toEqual(["address"]);
    expect(flagNames("mandate list")).toEqual([]);
    const cmd = s.commands.find((c) => c.name === "mandate list")!;
    expect(cmd.args[0].required).toBe(false);
  });

  it("wallet generate: no args, no flags", () => {
    expect(argNames("wallet generate")).toEqual([]);
    expect(flagNames("wallet generate")).toEqual([]);
  });

  it("doctor: no args, no flags", () => {
    expect(argNames("doctor")).toEqual([]);
    expect(flagNames("doctor")).toEqual([]);
  });

  it("schema: no args, no flags", () => {
    expect(argNames("schema")).toEqual([]);
    expect(flagNames("schema")).toEqual([]);
  });
});

// ─── A1: Required args → MISSING_ARGS ───────────────────────────

describe("A1: Required args enforce MISSING_ARGS", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mandate create: throws MISSING_ARGS with fewer than 4 args", async () => {
    const { mandateCreate } = await import("../src/commands/mandate");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    await expect(mandateCreate(ctx, [VALID_ADDRESS, "1", "50"], {}, reqCtx))
      .rejects.toThrow(CliError);

    try {
      await mandateCreate(ctx, [VALID_ADDRESS, "1"], {}, reqCtx);
    } catch (e) {
      expect((e as CliError).code).toBe("MISSING_ARGS");
    }
  });

  it("prepaid deposit: throws MISSING_ARGS with fewer than 2 args", async () => {
    const { prepaidDeposit } = await import("../src/commands/prepaid");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await prepaidDeposit(ctx, [VALID_ADDRESS], {}, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MISSING_ARGS");
    }
  });

  it("prepaid status: throws MISSING_ARGS with no args", async () => {
    const { prepaidStatus } = await import("../src/commands/prepaid");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await prepaidStatus(ctx, [], {}, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MISSING_ARGS");
    }
  });

  it("mandate check: throws MISSING_ARGS with no args", async () => {
    const { mandateCheck } = await import("../src/commands/mandate");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await mandateCheck(ctx, [], {}, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MISSING_ARGS");
    }
  });

  it("pay-402: url flag required (MISSING_ARGS when --url absent)", async () => {
    const { pay402 } = await import("../src/commands/pay-402");
    const ctx = createMockContext();
    const reqCtx = createRequestContext("testnet");

    try {
      await pay402(ctx, [], { idempotencyKey: "test-key-abc" }, reqCtx);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MISSING_ARGS");
    }
  });
});

// ─── A3: Error code completeness ────────────────────────────────

describe("A3: Error code completeness", () => {
  let s: ParsedSchema;

  beforeEach(() => { s = captureSchemaOutput(); });

  /**
   * Complete set of CliError codes used across all source files.
   * Derived from code review of: context.ts, parse.ts, idempotency.ts,
   * index.ts, commands/pay.ts, pay-402.ts, balance.ts, receipt.ts,
   * mandate.ts, prepaid.ts.
   *
   * If you add a new error code to source, add it here too — that's the contract.
   */
  const SOURCE_ERROR_CODES = new Set([
    // Input validation (parse.ts, commands)
    "MISSING_ARGS",
    "INVALID_AMOUNT",
    "INVALID_ADDRESS",
    "INVALID_OBJECT_ID",
    "INVALID_DURATION",
    "INVALID_VALUE",
    "INVALID_URL",
    "INVALID_NETWORK",
    "INVALID_MANDATE",
    // Auth / wallet (context.ts, commands)
    "NO_WALLET",
    "NO_ADDRESS",
    // Idempotency (idempotency.ts, pay.ts, pay-402.ts)
    "IDEMPOTENCY_KEY_REQUIRED",
    "IDEMPOTENCY_CONFLICT",
    // Transaction execution (parse.ts assertTxSuccess)
    "TX_OUT_OF_GAS",
    "TX_OBJECT_CONFLICT",
    "TX_EXECUTION_ERROR",
    // Move abort codes (parse.ts ABORT_CODES)
    "INSUFFICIENT_PAYMENT",
    "ZERO_AMOUNT",
    "MANDATE_NOT_DELEGATE",
    "MANDATE_EXPIRED",
    "MANDATE_PER_TX_EXCEEDED",
    "MANDATE_TOTAL_EXCEEDED",
    "MANDATE_REVOKED",
    "PREPAID_NOT_AGENT",
    "PREPAID_NOT_PROVIDER",
    "PREPAID_WITHDRAWAL_LOCKED",
    "PREPAID_MAX_CALLS_EXCEEDED",
    "PREPAID_RATE_EXCEEDED",
    // Network (context.ts, pay-402.ts, index.ts)
    "NETWORK_ERROR",
    "TIMEOUT",
    // Object lookups (receipt.ts, mandate.ts, prepaid.ts)
    "OBJECT_NOT_FOUND",
    // pay-402 specific
    "UNKNOWN_402",
    "PAYMENT_FAILED",
    // System (index.ts)
    "UNKNOWN_COMMAND",
    "INTERNAL_ERROR",
  ]);

  it("schema errorCodes catalog covers every code used in source", () => {
    const schemaCodes = new Set(s.errorCodes.map((e) => e.code));
    for (const code of SOURCE_ERROR_CODES) {
      expect(
        schemaCodes.has(code),
        `Source uses "${code}" but it is MISSING from schema.errorCodes. Add it to buildSchema() in schema.ts.`,
      ).toBe(true);
    }
  });

  it("schema errorCodes has no orphan codes absent from source", () => {
    for (const entry of s.errorCodes) {
      expect(
        SOURCE_ERROR_CODES.has(entry.code),
        `Schema declares "${entry.code}" but it is NOT used in any source file. Remove it from schema.ts or add the usage.`,
      ).toBe(true);
    }
  });

  it("schema errorCodes catalog has exactly 35 entries", () => {
    // This number must match SOURCE_ERROR_CODES.size. Update both when adding codes.
    expect(s.errorCodes.length).toBe(SOURCE_ERROR_CODES.size);
  });

  it("retryable codes: TX_OUT_OF_GAS, TX_OBJECT_CONFLICT, NETWORK_ERROR, TIMEOUT, PREPAID_WITHDRAWAL_LOCKED are retryable", () => {
    const retryable = new Set(s.errorCodes.filter((e) => e.retryable).map((e) => e.code));
    expect(retryable.has("TX_OUT_OF_GAS")).toBe(true);
    expect(retryable.has("TX_OBJECT_CONFLICT")).toBe(true);
    expect(retryable.has("NETWORK_ERROR")).toBe(true);
    expect(retryable.has("TIMEOUT")).toBe(true);
    expect(retryable.has("PREPAID_WITHDRAWAL_LOCKED")).toBe(true);
  });

  it("non-retryable codes: IDEMPOTENCY_CONFLICT, PAYMENT_FAILED are non-retryable (payment may have landed)", () => {
    const codeMap = new Map(s.errorCodes.map((e) => [e.code, e]));
    expect(codeMap.get("IDEMPOTENCY_CONFLICT")!.retryable).toBe(false);
    expect(codeMap.get("PAYMENT_FAILED")!.retryable).toBe(false);
  });

  it("human-required codes: MANDATE_EXPIRED, MANDATE_TOTAL_EXCEEDED, MANDATE_REVOKED", () => {
    const codeMap = new Map(s.errorCodes.map((e) => [e.code, e]));
    expect(codeMap.get("MANDATE_EXPIRED")!.requiresHuman).toBe(true);
    expect(codeMap.get("MANDATE_TOTAL_EXCEEDED")!.requiresHuman).toBe(true);
    expect(codeMap.get("MANDATE_REVOKED")!.requiresHuman).toBe(true);
  });

  it("non-human-required codes: MANDATE_NOT_DELEGATE, MANDATE_PER_TX_EXCEEDED should NOT require human", () => {
    const codeMap = new Map(s.errorCodes.map((e) => [e.code, e]));
    // These are agent-recoverable without human intervention
    expect(codeMap.get("MANDATE_NOT_DELEGATE")!.requiresHuman).toBeFalsy();
    expect(codeMap.get("MANDATE_PER_TX_EXCEEDED")!.requiresHuman).toBeFalsy();
  });
});

// ─── A4: Global flags consistency ───────────────────────────────

describe("A4: Global flags consistency", () => {
  let s: ParsedSchema;

  beforeEach(() => { s = captureSchemaOutput(); });

  it("schema globalFlags contains exactly: network, human, timeout, verbose", () => {
    const names = s.globalFlags.map((f) => f.name).sort();
    expect(names).toEqual(["human", "json", "network", "timeout", "verbose"]);
  });

  it("network global flag: string type, default testnet", () => {
    const flag = s.globalFlags.find((f) => f.name === "network")!;
    expect(flag.type).toBe("string");
    expect(flag.default).toBe("testnet");
  });

  it("human global flag: boolean type, default false", () => {
    const flag = s.globalFlags.find((f) => f.name === "human")!;
    expect(flag.type).toBe("boolean");
    expect(flag.default).toBe(false);
  });

  it("timeout global flag: number type, default 30000ms", () => {
    const flag = s.globalFlags.find((f) => f.name === "timeout")!;
    expect(flag.type).toBe("number");
    expect(flag.default).toBe(30000);
  });

  it("verbose global flag: boolean type, default false", () => {
    const flag = s.globalFlags.find((f) => f.name === "verbose")!;
    expect(flag.type).toBe("boolean");
    expect(flag.default).toBe(false);
  });

  it("global flags + all command flags union = complete parseArgs options set", () => {
    // These are the exact options declared in index.ts parseArgs.
    // If parseArgs options change, update this test AND the schema.
    const expectedParseArgsOptions = new Set([
      "network", "human", "json", "coin", "memo", "dry-run", "idempotency-key",
      "url", "method", "body", "header", "mandate", "registry",
      "rate", "max-calls", "verbose", "timeout",
    ]);

    const allSchemaFlags = new Set<string>();
    for (const f of s.globalFlags) allSchemaFlags.add(f.name);
    for (const cmd of s.commands) {
      for (const f of cmd.flags) allSchemaFlags.add(f.name);
    }

    // Every schema flag must be in parseArgs
    for (const name of allSchemaFlags) {
      expect(
        expectedParseArgsOptions.has(name),
        `Schema flag "${name}" is not handled in index.ts parseArgs options`,
      ).toBe(true);
    }

    // Every parseArgs option must be declared in schema (global or command-level)
    for (const name of expectedParseArgsOptions) {
      expect(
        allSchemaFlags.has(name),
        `parseArgs option "${name}" is not declared in schema (globalFlags or any command flags)`,
      ).toBe(true);
    }
  });

  it("dry-run flag only declared on commands that actually support it", () => {
    // per spec: pay, pay-402, prepaid deposit, mandate create
    const commandsWithDryRun = s.commands
      .filter((c) => c.flags.some((f) => f.name === "dry-run"))
      .map((c) => c.name)
      .sort();

    expect(commandsWithDryRun).toEqual(
      ["mandate create", "pay", "pay-402", "prepaid deposit"].sort(),
    );
  });

  it("coin flag only declared on commands that accept a coin type override", () => {
    // balance, pay, pay-402 (via requirements), prepaid deposit, mandate create
    // Note: pay-402 does NOT have --coin (coin comes from the 402 requirements header)
    const commandsWithCoin = s.commands
      .filter((c) => c.flags.some((f) => f.name === "coin"))
      .map((c) => c.name)
      .sort();

    expect(commandsWithCoin).toEqual(
      ["balance", "mandate create", "pay", "prepaid deposit"].sort(),
    );
  });
});
