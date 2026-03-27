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

  it("creates all 6 files in the correct subdirectory structure", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const base = path.join(tmpDir, "bank-account");
    const expectedFiles = [
      "index.ts",
      "bank-account.ts",
      "commands/index.ts",
      "commands/create-bank-account.ts",
      "command-handlers/index.ts",
      "command-handlers/handle-create-bank-account.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates aggregate with DefineEvents/DefineCommands and imported handler", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "bank-account", "bank-account.ts"),
      "utf-8",
    );
    expect(content).toContain("defineAggregate");
    expect(content).toContain("DefineEvents");
    expect(content).toContain("DefineCommands");
    expect(content).toContain("BankAccountDef");
    expect(content).toContain("handleCreateBankAccount");
  });

  it("generates standalone command handler", async () => {
    await generateAggregate("BankAccount", tmpDir);

    const content = await readFile(
      path.join(
        tmpDir,
        "bank-account/command-handlers/handle-create-bank-account.ts",
      ),
      "utf-8",
    );
    expect(content).toContain("export function handleCreateBankAccount");
    expect(content).toContain('"BankAccountCreated" as const');
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
