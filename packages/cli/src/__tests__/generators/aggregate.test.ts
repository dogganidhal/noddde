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

  it("creates all 8 files in the correct structure", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const base = path.join(tmpDir, "bank-account");
    const expectedFiles = [
      "index.ts",
      "state.ts",
      "aggregate.ts",
      "infrastructure.ts",
      "events/index.ts",
      "events/bank-account-created.ts",
      "commands/index.ts",
      "commands/create-bank-account.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates valid TypeScript content", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const aggregateContent = await readFile(
      path.join(tmpDir, "bank-account", "aggregate.ts"),
      "utf-8",
    );
    expect(aggregateContent).toContain("defineAggregate");
    expect(aggregateContent).toContain("BankAccountDef");
    expect(aggregateContent).toContain("initialBankAccountState");
  });

  it("does not overwrite existing files", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const statePath = path.join(tmpDir, "bank-account", "state.ts");
    const originalContent = await readFile(statePath, "utf-8");

    await generateAggregate("BankAccount", tmpDir);

    const afterContent = await readFile(statePath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("handles different name casings", async () => {
    await generateAggregate("bank-account", tmpDir);

    const base = path.join(tmpDir, "bank-account");
    const content = await readFile(path.join(base, "aggregate.ts"), "utf-8");
    expect(content).toContain("BankAccount");
    expect(content).toContain("BankAccountDef");
  });
});
