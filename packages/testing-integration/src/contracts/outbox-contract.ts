import type { OutboxStore } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

export interface OutboxContractContext {
  outbox: OutboxStore;
  cleanup?: () => Promise<void>;
}

export type OutboxContractFactory = () =>
  | OutboxContractContext
  | Promise<OutboxContractContext>;

export function defineOutboxContract(
  adapterLabel: string,
  factory: OutboxContractFactory,
): void {
  describe(`OutboxContract: ${adapterLabel}`, () => {
    let ctx: OutboxContractContext;
    beforeEach(async () => {
      ctx = await factory();
    });
    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it("saves and returns unpublished entries in creation order", async () => {
      await ctx.outbox.save([
        {
          id: "e-1",
          event: { name: "OrderPlaced", payload: {} },
          createdAt: new Date("2024-01-01T00:00:00Z"),
          publishedAt: null,
        },
        {
          id: "e-2",
          event: { name: "OrderConfirmed", payload: {} },
          createdAt: new Date("2024-01-01T00:00:01Z"),
          publishedAt: null,
        },
      ]);
      const unpublished = await ctx.outbox.loadUnpublished();
      expect(unpublished.map((e) => e.id)).toEqual(["e-1", "e-2"]);
    });

    it("excludes entries with a non-null publishedAt from loadUnpublished", async () => {
      await ctx.outbox.save([
        {
          id: "a",
          event: { name: "E", payload: {} },
          createdAt: new Date("2024-01-01"),
          publishedAt: null,
        },
        {
          id: "b",
          event: { name: "E", payload: {} },
          createdAt: new Date("2024-01-02"),
          publishedAt: null,
        },
      ]);
      await ctx.outbox.markPublished(["a"]);
      const unpublished = await ctx.outbox.loadUnpublished();
      expect(unpublished.map((e) => e.id)).toEqual(["b"]);
    });

    it("matches by eventId metadata in markPublishedByEventIds", async () => {
      await ctx.outbox.save([
        {
          id: "a",
          event: {
            name: "E",
            payload: {},
            metadata: {
              eventId: "evt-xyz",
              timestamp: "2024-01-01T00:00:00Z",
              correlationId: "c",
              causationId: "cmd",
            },
          },
          createdAt: new Date("2024-01-01"),
          publishedAt: null,
        },
        {
          id: "b",
          event: {
            name: "E",
            payload: {},
            metadata: {
              eventId: "evt-other",
              timestamp: "2024-01-01T00:00:01Z",
              correlationId: "c",
              causationId: "cmd",
            },
          },
          createdAt: new Date("2024-01-02"),
          publishedAt: null,
        },
      ]);
      await ctx.outbox.markPublishedByEventIds(["evt-xyz"]);
      const unpublished = await ctx.outbox.loadUnpublished();
      expect(unpublished.map((e) => e.id)).toEqual(["b"]);
    });

    it("deletePublished removes only entries whose publishedAt is set", async () => {
      await ctx.outbox.save([
        {
          id: "p",
          event: { name: "E", payload: {} },
          createdAt: new Date("2024-01-01"),
          publishedAt: null,
        },
        {
          id: "u",
          event: { name: "E", payload: {} },
          createdAt: new Date("2024-01-02"),
          publishedAt: null,
        },
      ]);
      await ctx.outbox.markPublished(["p"]);
      await ctx.outbox.deletePublished();
      const unpublished = await ctx.outbox.loadUnpublished();
      expect(unpublished.map((e) => e.id)).toEqual(["u"]);
    });

    it("respects the batch size argument to loadUnpublished", async () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        id: `e-${i}`,
        event: { name: "E", payload: {} },
        createdAt: new Date(2024, 0, 1, 0, 0, i),
        publishedAt: null,
      }));
      await ctx.outbox.save(entries);
      const batch = await ctx.outbox.loadUnpublished(2);
      expect(batch).toHaveLength(2);
    });
  });
}
