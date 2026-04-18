import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateProjection } from "../../generators/projection.js";
import { addQueryToProjection } from "../../generators/add-query.js";

describe("addQueryToProjection", () => {
  let tmpDir: string;
  let projDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
    await generateProjection("AuctionSummary", tmpDir);
    projDir = path.join(tmpDir, "auction-summary");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates query payload and handler files", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const expectedFiles = [
      "queries/list-auctions.ts",
      "query-handlers/handle-list-auctions.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(projDir, file))).resolves.toBeUndefined();
    }
  });

  it("generates query payload interface", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const content = await readFile(
      path.join(projDir, "queries/list-auctions.ts"),
      "utf-8",
    );
    expect(content).toContain("interface ListAuctionsPayload");
  });

  it("generates query handler using InferProjectionQueryHandler", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const content = await readFile(
      path.join(projDir, "query-handlers/handle-list-auctions.ts"),
      "utf-8",
    );
    expect(content).toContain("InferProjectionQueryHandler");
    expect(content).toContain("AuctionSummaryProjectionDef");
    expect(content).toContain("handleListAuctions");
  });

  it("updates queries/index.ts with new import and DefineQueries entry", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const content = await readFile(
      path.join(projDir, "queries/index.ts"),
      "utf-8",
    );
    expect(content).toContain("ListAuctionsPayload");
    expect(content).toContain("ListAuctions:");
  });

  it("updates query-handlers/index.ts barrel", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const content = await readFile(
      path.join(projDir, "query-handlers/index.ts"),
      "utf-8",
    );
    expect(content).toContain("handleGetAuctionSummary");
    expect(content).toContain("handleListAuctions");
  });

  it("updates projection definition file with new handler", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const content = await readFile(
      path.join(projDir, "auction-summary.ts"),
      "utf-8",
    );
    expect(content).toContain("handleListAuctions");
    expect(content).toContain("ListAuctions: handleListAuctions,");
  });

  it("is idempotent — skips if query already exists", async () => {
    await addQueryToProjection("ListAuctions", projDir);

    const contentBefore = await readFile(
      path.join(projDir, "auction-summary.ts"),
      "utf-8",
    );

    await addQueryToProjection("ListAuctions", projDir);

    const contentAfter = await readFile(
      path.join(projDir, "auction-summary.ts"),
      "utf-8",
    );
    expect(contentAfter).toBe(contentBefore);
  });

  it("rejects invalid query names", async () => {
    await expect(addQueryToProjection("123Invalid", projDir)).rejects.toThrow(
      "Invalid name",
    );
  });
});
