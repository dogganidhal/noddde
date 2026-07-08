import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  TypeORMEventIdempotencyStore,
  NodddeEventIdempotencyEntity,
} from "../index";

describe("TypeORMEventIdempotencyStore", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [NodddeEventIdempotencyEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    expect(await store.hasProcessed("never-seen")).toBe(false);
  });

  it("should not throw when markProcessed is called twice for the same key", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    await store.markProcessed("evt-dup");
    await expect(store.markProcessed("evt-dup")).resolves.toBeUndefined();
    expect(await store.hasProcessed("evt-dup")).toBe(true);
  });

  it("should remove expired records via removeExpired while keeping recent ones", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    await store.markProcessed("evt-old");
    // Force an old processedAt directly via the repository to simulate age.
    const repo = dataSource.getRepository(NodddeEventIdempotencyEntity);
    await repo.update(
      { key: "evt-old" },
      { processedAt: new Date(Date.now() - 10_000) },
    );
    await store.markProcessed("evt-recent");

    await store.removeExpired(5_000);

    expect(await store.hasProcessed("evt-old")).toBe(false);
    expect(await store.hasProcessed("evt-recent")).toBe(true);
  });

  it("should apply lazy TTL cleanup on hasProcessed when constructed with ttlMs", async () => {
    const store = new TypeORMEventIdempotencyStore(
      dataSource,
      { current: null },
      100,
    );

    await store.markProcessed("evt-ttl");
    const repo = dataSource.getRepository(NodddeEventIdempotencyEntity);
    await repo.update(
      { key: "evt-ttl" },
      { processedAt: new Date(Date.now() - 200) },
    );

    expect(await store.hasProcessed("evt-ttl")).toBe(false);
  });
});
