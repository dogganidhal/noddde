import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateProjection } from "../../generators/projection.js";
import { addEventHandlerToProjection } from "../../generators/add-event-handler.js";

describe("addEventHandlerToProjection", () => {
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

  it("creates on-entry file", async () => {
    await addEventHandlerToProjection("BidPlaced", projDir);

    await expect(
      access(path.join(projDir, "on-entries/on-bid-placed.ts")),
    ).resolves.toBeUndefined();
  });

  it("generates view reducer with correct event name", async () => {
    await addEventHandlerToProjection("BidPlaced", projDir);

    const content = await readFile(
      path.join(projDir, "on-entries/on-bid-placed.ts"),
      "utf-8",
    );
    expect(content).toContain("onBidPlaced");
    expect(content).toContain("AuctionSummaryView");
    expect(content).toContain('"BidPlaced"');
  });

  it("updates on-entries/index.ts barrel", async () => {
    await addEventHandlerToProjection("BidPlaced", projDir);

    const content = await readFile(
      path.join(projDir, "on-entries/index.ts"),
      "utf-8",
    );
    expect(content).toContain("onAuctionSummaryCreated");
    expect(content).toContain("onBidPlaced");
  });

  it("updates projection definition file with new on-entry", async () => {
    await addEventHandlerToProjection("BidPlaced", projDir);

    const content = await readFile(
      path.join(projDir, "auction-summary.ts"),
      "utf-8",
    );
    expect(content).toContain("onBidPlaced");
    expect(content).toContain("BidPlaced:");
  });

  it("is idempotent — skips if handler already exists", async () => {
    await addEventHandlerToProjection("BidPlaced", projDir);

    const contentBefore = await readFile(
      path.join(projDir, "auction-summary.ts"),
      "utf-8",
    );

    await addEventHandlerToProjection("BidPlaced", projDir);

    const contentAfter = await readFile(
      path.join(projDir, "auction-summary.ts"),
      "utf-8",
    );
    expect(contentAfter).toBe(contentBefore);
  });

  it("rejects invalid event names", async () => {
    await expect(
      addEventHandlerToProjection("123Invalid", projDir),
    ).rejects.toThrow("Invalid name");
  });
});
