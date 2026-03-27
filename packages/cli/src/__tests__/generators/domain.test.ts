import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateDomain } from "../../generators/domain.js";

describe("generateDomain", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates all 20 files in the correct structure", async () => {
    await generateDomain("BankAccount", tmpDir);

    const base = path.join(tmpDir, "bank-account");
    const expectedFiles = [
      // Event model
      "domain/event-model/index.ts",
      "domain/event-model/bank-account-created.ts",
      // Write model
      "domain/write-model/index.ts",
      "domain/write-model/aggregates/bank-account/index.ts",
      "domain/write-model/aggregates/bank-account/bank-account.ts",
      "domain/write-model/aggregates/bank-account/commands/index.ts",
      "domain/write-model/aggregates/bank-account/commands/create-bank-account.ts",
      "domain/write-model/aggregates/bank-account/command-handlers/index.ts",
      "domain/write-model/aggregates/bank-account/command-handlers/handle-create-bank-account.ts",
      // Read model
      "domain/read-model/projections/bank-account/index.ts",
      "domain/read-model/projections/bank-account/bank-account.ts",
      "domain/read-model/projections/bank-account/queries/index.ts",
      "domain/read-model/projections/bank-account/queries/get-bank-account.ts",
      "domain/read-model/projections/bank-account/query-handlers/index.ts",
      "domain/read-model/projections/bank-account/query-handlers/handle-get-bank-account.ts",
      "domain/read-model/projections/bank-account/view-reducers/index.ts",
      "domain/read-model/projections/bank-account/view-reducers/on-bank-account-created.ts",
      // Domain wiring
      "domain/domain.ts",
      "infrastructure/index.ts",
      "main.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates aggregate with defineAggregate and imported handler", async () => {
    await generateDomain("BankAccount", tmpDir);

    const aggPath = path.join(
      tmpDir,
      "bank-account/domain/write-model/aggregates/bank-account/bank-account.ts",
    );
    const content = await readFile(aggPath, "utf-8");
    expect(content).toContain("defineAggregate");
    expect(content).toContain("BankAccountDef");
    expect(content).toContain("handleCreateBankAccount");
    expect(content).toContain("DefineEvents");
    expect(content).toContain("DefineCommands");
  });

  it("generates standalone command handler", async () => {
    await generateDomain("BankAccount", tmpDir);

    const handlerPath = path.join(
      tmpDir,
      "bank-account/domain/write-model/aggregates/bank-account/command-handlers/handle-create-bank-account.ts",
    );
    const content = await readFile(handlerPath, "utf-8");
    expect(content).toContain("export function handleCreateBankAccount");
    expect(content).toContain('"BankAccountCreated" as const');
  });

  it("generates projection with on map and imported handlers", async () => {
    await generateDomain("BankAccount", tmpDir);

    const projPath = path.join(
      tmpDir,
      "bank-account/domain/read-model/projections/bank-account/bank-account.ts",
    );
    const content = await readFile(projPath, "utf-8");
    expect(content).toContain("defineProjection");
    expect(content).toContain("on:");
    expect(content).toContain("handleGetBankAccount");
    expect(content).toContain("onBankAccountCreated");
  });

  it("generates standalone view reducer", async () => {
    await generateDomain("BankAccount", tmpDir);

    const reducerPath = path.join(
      tmpDir,
      "bank-account/domain/read-model/projections/bank-account/view-reducers/on-bank-account-created.ts",
    );
    const content = await readFile(reducerPath, "utf-8");
    expect(content).toContain("export function onBankAccountCreated");
    expect(content).toContain("BankAccountView");
  });

  it("generates standalone query handler", async () => {
    await generateDomain("BankAccount", tmpDir);

    const handlerPath = path.join(
      tmpDir,
      "bank-account/domain/read-model/projections/bank-account/query-handlers/handle-get-bank-account.ts",
    );
    const content = await readFile(handlerPath, "utf-8");
    expect(content).toContain("export async function handleGetBankAccount");
    expect(content).toContain("ViewStore");
  });

  it("generates domain.ts with defineDomain", async () => {
    await generateDomain("BankAccount", tmpDir);

    const domainPath = path.join(tmpDir, "bank-account/domain/domain.ts");
    const content = await readFile(domainPath, "utf-8");
    expect(content).toContain("defineDomain");
    expect(content).toContain("BankAccountInfrastructure");
    expect(content).toContain("BankAccount");
    expect(content).toContain("BankAccountProjection");
  });

  it("generates main.ts with wireDomain", async () => {
    await generateDomain("BankAccount", tmpDir);

    const mainPath = path.join(tmpDir, "bank-account/main.ts");
    const content = await readFile(mainPath, "utf-8");
    expect(content).toContain("wireDomain");
    expect(content).toContain("InMemoryCommandBus");
    expect(content).toContain("EventEmitterEventBus");
    expect(content).toContain("bankAccountDomain");
  });

  it("does not overwrite existing files", async () => {
    await generateDomain("BankAccount", tmpDir);

    const mainPath = path.join(tmpDir, "bank-account/main.ts");
    const originalContent = await readFile(mainPath, "utf-8");

    await generateDomain("BankAccount", tmpDir);

    const afterContent = await readFile(mainPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("handles different name casings", async () => {
    await generateDomain("bank-account", tmpDir);

    const domainPath = path.join(tmpDir, "bank-account/domain/domain.ts");
    const content = await readFile(domainPath, "utf-8");
    expect(content).toContain("BankAccount");
    expect(content).toContain("bankAccountDomain");
  });

  it("rejects invalid names", async () => {
    await expect(generateDomain("123Invalid", tmpDir)).rejects.toThrow(
      "Invalid name",
    );
  });
});
