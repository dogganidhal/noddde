import { describe, it, expect, vi } from "vitest";
import { InMemoryEventIdempotencyStore } from "@noddde/engine";

describe("InMemoryEventIdempotencyStore", () => {
  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new InMemoryEventIdempotencyStore();

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new InMemoryEventIdempotencyStore();

    expect(await store.hasProcessed("unknown")).toBe(false);
  });

  it("should not throw and should keep hasProcessed true when marking the same key twice", async () => {
    const store = new InMemoryEventIdempotencyStore();

    await store.markProcessed("evt-1");
    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should remove expired records and keep recent ones", async () => {
    const store = new InMemoryEventIdempotencyStore();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await store.markProcessed("old-evt");

    vi.spyOn(Date, "now").mockReturnValue(1_010_000); // 10s later
    await store.markProcessed("recent-evt");

    await store.removeExpired(5_000); // TTL = 5s, evaluated at "now" = 1_010_000

    expect(await store.hasProcessed("old-evt")).toBe(false);
    expect(await store.hasProcessed("recent-evt")).toBe(true);

    vi.restoreAllMocks();
  });

  it("should return false and clean up an expired record on hasProcessed", async () => {
    const store = new InMemoryEventIdempotencyStore(100); // 100ms TTL

    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await store.markProcessed("evt-1");

    vi.spyOn(Date, "now").mockReturnValue(1_000_200); // 200ms later, expired
    expect(await store.hasProcessed("evt-1")).toBe(false);

    vi.restoreAllMocks();
  });

  it("should return true for a non-expired record when ttlMs is configured", async () => {
    const store = new InMemoryEventIdempotencyStore(10_000); // 10s TTL

    await store.markProcessed("evt-2");

    expect(await store.hasProcessed("evt-2")).toBe(true);
  });
});
