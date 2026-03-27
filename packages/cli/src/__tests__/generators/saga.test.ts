import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateSaga } from "../../generators/saga.js";

describe("generateSaga", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates all 2 files in a flat structure", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const base = path.join(tmpDir, "order-fulfillment");
    const expectedFiles = ["index.ts", "saga.ts"];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates saga.ts with on map (not associations/handlers)", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const sagaContent = await readFile(
      path.join(tmpDir, "order-fulfillment", "saga.ts"),
      "utf-8",
    );
    expect(sagaContent).toContain("defineSaga");
    expect(sagaContent).toContain("OrderFulfillmentSagaDef");
    expect(sagaContent).toContain("OrderFulfillmentSagaState");
    expect(sagaContent).toContain("startedBy:");
    expect(sagaContent).toContain("on:");
    expect(sagaContent).not.toContain("associations:");
    expect(sagaContent).not.toContain("handlers:");
  });

  it("includes state inline in saga.ts", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const sagaContent = await readFile(
      path.join(tmpDir, "order-fulfillment", "saga.ts"),
      "utf-8",
    );
    expect(sagaContent).toContain("interface OrderFulfillmentSagaState");
    expect(sagaContent).toContain("initialOrderFulfillmentSagaState");
  });

  it("does not overwrite existing files", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const sagaPath = path.join(tmpDir, "order-fulfillment", "saga.ts");
    const originalContent = await readFile(sagaPath, "utf-8");

    await generateSaga("OrderFulfillment", tmpDir);

    const afterContent = await readFile(sagaPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("rejects invalid names", async () => {
    await expect(generateSaga("123Invalid", tmpDir)).rejects.toThrow(
      "Invalid name",
    );
  });
});
