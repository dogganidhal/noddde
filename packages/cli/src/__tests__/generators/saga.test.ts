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

  it("creates all 5 files in the correct structure", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const base = path.join(tmpDir, "order-fulfillment");
    const expectedFiles = [
      "index.ts",
      "state.ts",
      "saga.ts",
      "handlers/index.ts",
      "handlers/on-start-event.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates valid saga content", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const sagaContent = await readFile(
      path.join(tmpDir, "order-fulfillment", "saga.ts"),
      "utf-8",
    );
    expect(sagaContent).toContain("defineSaga");
    expect(sagaContent).toContain("OrderFulfillmentSagaDef");
    expect(sagaContent).toContain("initialOrderFulfillmentSagaState");
    expect(sagaContent).toContain(
      'import { onStartEvent } from "./handlers/index.js"',
    );
  });

  it("generates handler file with correct state type", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const handlerContent = await readFile(
      path.join(tmpDir, "order-fulfillment", "handlers", "on-start-event.ts"),
      "utf-8",
    );
    expect(handlerContent).toContain("export function onStartEvent");
    expect(handlerContent).toContain("OrderFulfillmentSagaState");
  });

  it("does not overwrite existing files", async () => {
    await generateSaga("OrderFulfillment", tmpDir);

    const statePath = path.join(tmpDir, "order-fulfillment", "state.ts");
    const originalContent = await readFile(statePath, "utf-8");

    await generateSaga("OrderFulfillment", tmpDir);

    const afterContent = await readFile(statePath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });
});
