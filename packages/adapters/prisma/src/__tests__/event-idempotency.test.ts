import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { PrismaEventIdempotencyStore } from "../event-idempotency";

const TEST_DB = path.resolve(__dirname, "../../prisma/test-idempotency.db");
const DATABASE_URL = `file:${TEST_DB}`;

describe("PrismaEventIdempotencyStore", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }

    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, DATABASE_URL },
      stdio: "pipe",
    });

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  beforeEach(async () => {
    await (prisma as any).nodddeEventIdempotencyRecord.deleteMany();
  });

  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, {
      als: new AsyncLocalStorage(),
    });

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, {
      als: new AsyncLocalStorage(),
    });

    expect(await store.hasProcessed("never-seen")).toBe(false);
  });

  it("should not throw when markProcessed is called twice for the same key", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, {
      als: new AsyncLocalStorage(),
    });

    await store.markProcessed("evt-dup");
    await expect(store.markProcessed("evt-dup")).resolves.toBeUndefined();
    expect(await store.hasProcessed("evt-dup")).toBe(true);
  });

  it("should remove expired records via removeExpired while keeping recent ones", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, {
      als: new AsyncLocalStorage(),
    });

    await store.markProcessed("evt-old");
    await (prisma as any).nodddeEventIdempotencyRecord.update({
      where: { key: "evt-old" },
      data: { processedAt: new Date(Date.now() - 10_000) },
    });
    await store.markProcessed("evt-recent");

    await store.removeExpired(5_000);

    expect(await store.hasProcessed("evt-old")).toBe(false);
    expect(await store.hasProcessed("evt-recent")).toBe(true);
  });

  it("should apply lazy TTL cleanup on hasProcessed when constructed with ttlMs", async () => {
    const store = new PrismaEventIdempotencyStore(
      prisma,
      { als: new AsyncLocalStorage() },
      100,
    );

    await store.markProcessed("evt-ttl");
    await (prisma as any).nodddeEventIdempotencyRecord.update({
      where: { key: "evt-ttl" },
      data: { processedAt: new Date(Date.now() - 200) },
    });

    expect(await store.hasProcessed("evt-ttl")).toBe(false);
  });
});
