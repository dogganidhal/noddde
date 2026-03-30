import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateAggregate } from "../../generators/aggregate.js";

describe("generateAggregate", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates all 9 files in the correct subdirectory structure", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const base = path.join(tmpDir, "bank-account");
    const expectedFiles = [
      "index.ts",
      "state.ts",
      "bank-account.ts",
      "commands/index.ts",
      "commands/create-bank-account.ts",
      "deciders/index.ts",
      "deciders/decide-create-bank-account.ts",
      "evolvers/index.ts",
      "evolvers/evolve-bank-account-created.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates aggregate with DefineEvents/DefineCommands and imported handlers", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "bank-account", "bank-account.ts"),
      "utf-8",
    );
    expect(content).toContain("defineAggregate");
    expect(content).toContain("DefineEvents");
    expect(content).toContain("DefineCommands");
    expect(content).toContain("export type BankAccountDef");
    expect(content).toContain("decideCreateBankAccount");
    expect(content).toContain("evolveBankAccountCreated");
    expect(content).toContain('from "./evolvers/index.js"');
  });

  it("generates standalone decide handler using InferDecideHandler", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "bank-account/deciders/decide-create-bank-account.ts"),
      "utf-8",
    );
    expect(content).toContain("InferDecideHandler");
    expect(content).toContain("BankAccountDef");
    expect(content).toContain("decideCreateBankAccount");
    expect(content).toContain('"BankAccountCreated" as const');
  });

  it("generates standalone evolve handler using InferEvolveHandler", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "bank-account/evolvers/evolve-bank-account-created.ts"),
      "utf-8",
    );
    expect(content).toContain("InferEvolveHandler");
    expect(content).toContain("BankAccountDef");
    expect(content).toContain("evolveBankAccountCreated");
  });

  it("generates command payload interface", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "bank-account/commands/create-bank-account.ts"),
      "utf-8",
    );
    expect(content).toContain("interface CreateBankAccountPayload");
  });

  it("does not overwrite existing files", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const aggPath = path.join(tmpDir, "bank-account", "bank-account.ts");
    const originalContent = await readFile(aggPath, "utf-8");

    await generateAggregate("BankAccount", tmpDir);

    const afterContent = await readFile(aggPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("handles different name casings", async () => {
    await generateAggregate("bank-account", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "bank-account", "bank-account.ts"),
      "utf-8",
    );
    expect(content).toContain("BankAccount");
    expect(content).toContain("BankAccountDef");
  });

  it("rejects invalid names", async () => {
    await expect(generateAggregate("123Invalid", tmpDir)).rejects.toThrow(
      "Invalid name",
    );
  });
});
