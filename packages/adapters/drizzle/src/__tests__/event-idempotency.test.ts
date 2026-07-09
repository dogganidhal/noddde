import { describe, it, expect, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { eventIdempotency } from "../sqlite/schema";
import { DrizzleEventIdempotencyStore } from "../event-idempotency";

describe("DrizzleEventIdempotencyStore (sqlite)", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    db = drizzle(sqlite);
    db.run(sql`
      CREATE TABLE noddde_event_idempotency (
        key TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      )
    `);
  });

  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    expect(await store.hasProcessed("never-seen")).toBe(false);
  });

  it("should not throw when markProcessed is called twice for the same key", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    await store.markProcessed("evt-dup");
    await expect(store.markProcessed("evt-dup")).resolves.toBeUndefined();
    expect(await store.hasProcessed("evt-dup")).toBe(true);
  });

  it("should remove expired records via removeExpired while keeping recent ones", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    await store.markProcessed("evt-old");
    db.run(
      sql`UPDATE noddde_event_idempotency SET processed_at = ${new Date(Date.now() - 10_000).toISOString().replace("T", " ").replace("Z", "")} WHERE key = 'evt-old'`,
    );
    await store.markProcessed("evt-recent");

    await store.removeExpired(5_000);

    expect(await store.hasProcessed("evt-old")).toBe(false);
    expect(await store.hasProcessed("evt-recent")).toBe(true);
  });

  it("should apply lazy TTL cleanup on hasProcessed when constructed with ttlMs", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
      100,
    );

    await store.markProcessed("evt-ttl");
    db.run(
      sql`UPDATE noddde_event_idempotency SET processed_at = ${new Date(Date.now() - 200).toISOString().replace("T", " ").replace("Z", "")} WHERE key = 'evt-ttl'`,
    );

    expect(await store.hasProcessed("evt-ttl")).toBe(false);
  });
});
