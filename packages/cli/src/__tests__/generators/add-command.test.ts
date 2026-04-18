import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateAggregate } from "../../generators/aggregate.js";
import { addCommandToAggregate } from "../../generators/add-command.js";

describe("addCommandToAggregate", () => {
  let tmpDir: string;
  let aggDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
    await generateAggregate("Auction", tmpDir);
    aggDir = path.join(tmpDir, "auction");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates command payload, decider, and evolver files", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const expectedFiles = [
      "commands/place-bid.ts",
      "deciders/decide-place-bid.ts",
      "evolvers/evolve-bid-placed.ts",
    ];

    for (const file of expectedFiles) {
      await expect(access(path.join(aggDir, file))).resolves.toBeUndefined();
    }
  });

  it("generates command payload interface", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(
      path.join(aggDir, "commands/place-bid.ts"),
      "utf-8",
    );
    expect(content).toContain("interface PlaceBidPayload");
  });

  it("generates decider using InferDecideHandler", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(
      path.join(aggDir, "deciders/decide-place-bid.ts"),
      "utf-8",
    );
    expect(content).toContain("InferDecideHandler");
    expect(content).toContain("AuctionDef");
    expect(content).toContain("decidePlaceBid");
    expect(content).toContain('"BidPlaced" as const');
  });

  it("generates evolver using InferEvolveHandler", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(
      path.join(aggDir, "evolvers/evolve-bid-placed.ts"),
      "utf-8",
    );
    expect(content).toContain("InferEvolveHandler");
    expect(content).toContain("AuctionDef");
    expect(content).toContain("evolveBidPlaced");
  });

  it("updates commands/index.ts barrel with new export", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(
      path.join(aggDir, "commands/index.ts"),
      "utf-8",
    );
    expect(content).toContain("CreateAuctionPayload");
    expect(content).toContain("PlaceBidPayload");
  });

  it("updates deciders/index.ts barrel with new export", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(
      path.join(aggDir, "deciders/index.ts"),
      "utf-8",
    );
    expect(content).toContain("decideCreateAuction");
    expect(content).toContain("decidePlaceBid");
  });

  it("updates evolvers/index.ts barrel with new export", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(
      path.join(aggDir, "evolvers/index.ts"),
      "utf-8",
    );
    expect(content).toContain("evolveAuctionCreated");
    expect(content).toContain("evolveBidPlaced");
  });

  it("updates aggregate definition file with new command and event", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const content = await readFile(path.join(aggDir, "auction.ts"), "utf-8");

    // Imports added
    expect(content).toContain("PlaceBidPayload");
    expect(content).toContain("decidePlaceBid");
    expect(content).toContain("evolveBidPlaced");

    // DefineCommands updated
    expect(content).toContain("PlaceBid: PlaceBidPayload;");

    // DefineEvents updated
    expect(content).toContain("BidPlaced: { id: string };");

    // decide map updated
    expect(content).toContain("PlaceBid: decidePlaceBid,");

    // evolve map updated
    expect(content).toContain("BidPlaced: evolveBidPlaced,");
  });

  it("is idempotent — skips if command already exists", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const contentBefore = await readFile(
      path.join(aggDir, "auction.ts"),
      "utf-8",
    );

    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });

    const contentAfter = await readFile(
      path.join(aggDir, "auction.ts"),
      "utf-8",
    );
    expect(contentAfter).toBe(contentBefore);
  });

  it("can add multiple commands sequentially", async () => {
    await addCommandToAggregate("PlaceBid", aggDir, {
      eventName: "BidPlaced",
    });
    await addCommandToAggregate("CloseAuction", aggDir, {
      eventName: "AuctionClosed",
    });

    const content = await readFile(path.join(aggDir, "auction.ts"), "utf-8");
    expect(content).toContain("PlaceBid: decidePlaceBid,");
    expect(content).toContain("CloseAuction: decideCloseAuction,");
    expect(content).toContain("BidPlaced: evolveBidPlaced,");
    expect(content).toContain("AuctionClosed: evolveAuctionClosed,");
  });

  it("rejects invalid command names", async () => {
    await expect(
      addCommandToAggregate("123Invalid", aggDir, { eventName: "Invalid" }),
    ).rejects.toThrow("Invalid name");
  });
});
