import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should save entries and load them as unpublished", async () => {
    const store = new InMemoryOutboxStore();
    const entries: OutboxEntry[] = [
      {
        id: "entry-1",
        event: { name: "OrderCreated", payload: { orderId: "o1" } },
        aggregateName: "Order",
        aggregateId: "o1",
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "entry-2",
        event: { name: "OrderShipped", payload: { orderId: "o1" } },
        aggregateName: "Order",
        aggregateId: "o1",
        createdAt: "2025-01-01T00:00:01.000Z",
        publishedAt: null,
      },
    ];

    await store.save(entries);
    const unpublished = await store.loadUnpublished();

    expect(unpublished).toHaveLength(2);
    expect(unpublished[0]!.id).toBe("entry-1");
    expect(unpublished[1]!.id).toBe("entry-2");
  });

  it("should limit results to batchSize", async () => {
    const store = new InMemoryOutboxStore();
    const entries: OutboxEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: `entry-${i}`,
      event: { name: "Evt", payload: {} },
      createdAt: `2025-01-01T00:00:0${i}.000Z`,
      publishedAt: null,
    }));

    await store.save(entries);
    const batch = await store.loadUnpublished(3);

    expect(batch).toHaveLength(3);
    expect(batch[0]!.id).toBe("entry-0");
    expect(batch[2]!.id).toBe("entry-2");
  });

  it("should return entries sorted by createdAt ascending", async () => {
    const store = new InMemoryOutboxStore();
    // Insert in reverse order
    await store.save([
      {
        id: "late",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:02.000Z",
        publishedAt: null,
      },
      {
        id: "early",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    const unpublished = await store.loadUnpublished();
    expect(unpublished[0]!.id).toBe("early");
    expect(unpublished[1]!.id).toBe("late");
  });

  it("should mark entries as published by ID", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "e1",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "e2",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:01.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublished(["e1"]);

    const unpublished = await store.loadUnpublished();
    expect(unpublished).toHaveLength(1);
    expect(unpublished[0]!.id).toBe("e2");

    const all = store.findAll();
    const e1 = all.find((e) => e.id === "e1")!;
    expect(e1.publishedAt).not.toBeNull();
  });

  it("should mark entries as published by event metadata eventId", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "e1",
        event: {
          name: "Evt",
          payload: {},
          metadata: {
            eventId: "evt-aaa",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "e2",
        event: {
          name: "Evt",
          payload: {},
          metadata: {
            eventId: "evt-bbb",
            timestamp: "2025-01-01T00:00:01.000Z",
          },
        },
        createdAt: "2025-01-01T00:00:01.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublishedByEventIds(["evt-aaa"]);

    const unpublished = await store.loadUnpublished();
    expect(unpublished).toHaveLength(1);
    expect(unpublished[0]!.id).toBe("e2");
  });

  it("should delete published entries older than cutoff", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "old",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "recent",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-06-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublished(["old", "recent"]);
    await store.deletePublished(new Date("2025-03-01T00:00:00.000Z"));

    const all = store.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("recent");
  });

  it("should delete all published entries when olderThan is omitted", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "e1",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "e2",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-06-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublished(["e1", "e2"]);
    await store.deletePublished();

    const all = store.findAll();
    expect(all).toHaveLength(0);
  });

  it("should return empty array when no unpublished entries exist", async () => {
    const store = new InMemoryOutboxStore();
    const result = await store.loadUnpublished();
    expect(result).toEqual([]);
  });

  it("should handle save with empty array", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([]);
    expect(store.findAll()).toHaveLength(0);
  });
});
