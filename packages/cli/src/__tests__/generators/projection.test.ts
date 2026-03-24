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

  it("creates all 5 files in the correct structure", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const base = path.join(tmpDir, "order-summary");
    const expectedFiles = [
      "index.ts",
      "view.ts",
      "projection.ts",
      "queries/index.ts",
      "queries/get-order-summary.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("generates valid projection content", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const projectionContent = await readFile(
      path.join(tmpDir, "order-summary", "projection.ts"),
      "utf-8",
    );
    expect(projectionContent).toContain("defineProjection");
    expect(projectionContent).toContain("OrderSummaryProjectionDef");
    expect(projectionContent).toContain("getOrderSummary");
  });

  it("generates query handler file", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const handlerContent = await readFile(
      path.join(tmpDir, "order-summary", "queries", "get-order-summary.ts"),
      "utf-8",
    );
    expect(handlerContent).toContain("export async function getOrderSummary");
    expect(handlerContent).toContain("OrderSummaryView");
  });

  it("does not overwrite existing files", async () => {
    await generateProjection("OrderSummary", tmpDir);

    const viewPath = path.join(tmpDir, "order-summary", "view.ts");
    const originalContent = await readFile(viewPath, "utf-8");

    await generateProjection("OrderSummary", tmpDir);

    const afterContent = await readFile(viewPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });
});
