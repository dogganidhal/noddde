import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  // ### save and exists round-trip
  it("should return true for exists after save", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    expect(await store.exists("cmd-1")).toBe(true);
  });

  // ### exists returns false for unknown commandId
  it("should return false for an unknown commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    expect(await store.exists("unknown")).toBe(false);
  });

  // ### remove deletes the record
  it("should return false for exists after remove", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    await store.remove("cmd-1");
    expect(await store.exists("cmd-1")).toBe(false);
  });

  // ### remove is no-op for non-existent commandId
  it("should not throw when removing a non-existent commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    await expect(store.remove("non-existent")).resolves.toBeUndefined();
  });

  // ### removeExpired removes old records and keeps recent ones
  it("should remove expired records and keep recent ones", async () => {
    const store = new InMemoryIdempotencyStore();
    const now = Date.now();

    await store.save({
      commandId: "old-cmd",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date(now - 10_000).toISOString(), // 10s ago
    });

    await store.save({
      commandId: "recent-cmd",
      aggregateName: "Order",
      aggregateId: "order-2",
      processedAt: new Date(now).toISOString(), // now
    });

    await store.removeExpired(5_000); // TTL = 5s

    expect(await store.exists("old-cmd")).toBe(false);
    expect(await store.exists("recent-cmd")).toBe(true);
  });

  // ### lazy TTL cleanup on exists when ttlMs is configured
  it("should return false and clean up expired record on exists when ttlMs is configured", async () => {
    const store = new InMemoryIdempotencyStore(100); // 100ms TTL

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date(Date.now() - 200).toISOString(), // 200ms ago, expired
    });

    expect(await store.exists("cmd-1")).toBe(false);
  });

  it("should return true for non-expired record when ttlMs is configured", async () => {
    const store = new InMemoryIdempotencyStore(10_000); // 10s TTL

    await store.save({
      commandId: "cmd-2",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(), // just now
    });

    expect(await store.exists("cmd-2")).toBe(true);
  });

  // ### supports numeric and bigint commandIds
  it("should support number commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: 42,
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    expect(await store.exists(42)).toBe(true);
  });

  it("should support bigint commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: 9007199254740993n,
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    expect(await store.exists(9007199254740993n)).toBe(true);
  });
});
