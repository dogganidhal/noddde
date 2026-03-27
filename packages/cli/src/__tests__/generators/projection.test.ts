import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateProjection } from "../../generators/projection.js";

describe("generateProjection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates all 8 files in the correct subdirectory structure", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const base = path.join(tmpDir, "order-summary");
    const expectedFiles = [
      "index.ts",
      "order-summary.ts",
      "queries/index.ts",
      "queries/get-order-summary.ts",
      "query-handlers/index.ts",
      "query-handlers/handle-get-order-summary.ts",
      "view-reducers/index.ts",
      "view-reducers/on-order-summary-created.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates projection with on map and imported handlers", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "order-summary", "order-summary.ts"),
      "utf-8",
    );
    expect(content).toContain("defineProjection");
    expect(content).toContain("on:");
    expect(content).toContain("handleGetOrderSummary");
    expect(content).toContain("onOrderSummaryCreated");
    expect(content).not.toContain("reducers:");
  });

  it("generates standalone query handler", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const content = await readFile(
      path.join(
        tmpDir,
        "order-summary/query-handlers/handle-get-order-summary.ts",
      ),
      "utf-8",
    );
    expect(content).toContain("export async function handleGetOrderSummary");
    expect(content).toContain("ViewStore");
  });

  it("generates standalone view reducer", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const content = await readFile(
      path.join(
        tmpDir,
        "order-summary/view-reducers/on-order-summary-created.ts",
      ),
      "utf-8",
    );
    expect(content).toContain("export function onOrderSummaryCreated");
    expect(content).toContain("OrderSummaryView");
  });

  it("generates queries with view + DefineQueries", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const content = await readFile(
      path.join(tmpDir, "order-summary/queries/index.ts"),
      "utf-8",
    );
    expect(content).toContain("interface OrderSummaryView");
    expect(content).toContain("DefineQueries");
    expect(content).toContain("GetOrderSummary:");
  });

  it("does not overwrite existing files", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const projPath = path.join(tmpDir, "order-summary", "order-summary.ts");
    const originalContent = await readFile(projPath, "utf-8");

    await generateProjection("OrderSummary", tmpDir);

    const afterContent = await readFile(projPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("rejects invalid names", async () => {
    await expect(generateProjection("123Invalid", tmpDir)).rejects.toThrow(
      "Invalid name",
    );
  });
});
