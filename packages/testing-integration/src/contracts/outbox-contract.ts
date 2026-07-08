import type { OutboxEntry, OutboxStore } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

export interface OutboxContractContext {
  outbox: OutboxStore;
  /**
   * Optional escape hatch that returns *every* entry (published and
   * unpublished) via a raw read. The `OutboxStore` interface has no
   * "load published" method, so the `deletePublished(olderThan)` coverage
   * can't observe which published rows survived a cleanup without it.
   * Adapters wire this to a direct table read. When omitted, the
   * `deletePublished(olderThan)` cases are skipped for that adapter.
   */
  loadAll?: () => Promise<OutboxEntry[]>;
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

    // The no-arg `deletePublished()` above deletes every published entry.
    // The `olderThan` overload adds a temporal predicate that compares the
    // cutoff against `createdAt` — a path that is dialect-sensitive (TypeORM
    // `LessThan`, Drizzle `lt(...createdAt, toDbTimestamp(...))`) and, on
    // MySQL, historically at risk of string-vs-string collation surprises.
    // These two cases pin the comparison down. They need a raw read of
    // surviving rows (there's no "load published"), so they defer to the
    // optional `loadAll` hook and skip when the adapter doesn't provide one.
    describe("deletePublished(olderThan)", () => {
      const t1 = new Date("2024-01-01T00:00:00.000Z");
      const t2 = new Date("2024-01-02T00:00:00.000Z");
      const t3 = new Date("2024-01-03T00:00:00.000Z");
      const cutoff = new Date("2024-01-02T12:00:00.000Z");

      it("removes only published entries created before the cutoff", async () => {
        if (!ctx.loadAll) return; // unobservable without a raw read
        await ctx.outbox.save([
          {
            id: "a",
            event: { name: "E", payload: {} },
            createdAt: t1,
            publishedAt: null,
          },
          {
            id: "b",
            event: { name: "E", payload: {} },
            createdAt: t2,
            publishedAt: null,
          },
          {
            id: "c",
            event: { name: "E", payload: {} },
            createdAt: t3,
            publishedAt: null,
          },
        ]);
        await ctx.outbox.markPublished(["a", "b", "c"]);

        await ctx.outbox.deletePublished(cutoff);

        const remaining = (await ctx.loadAll()).map((e) => e.id).sort();
        // a (t1) and b (t2) precede the cutoff → gone. c (t3) survives.
        expect(remaining).toEqual(["c"]);
      });

      it("never deletes unpublished entries even when older than the cutoff", async () => {
        if (!ctx.loadAll) return;
        await ctx.outbox.save([
          {
            id: "pub-old",
            event: { name: "E", payload: {} },
            createdAt: t1,
            publishedAt: null,
          },
          {
            id: "unpub-old",
            event: { name: "E", payload: {} },
            createdAt: t1,
            publishedAt: null,
          },
        ]);
        // Only the first is published; the second stays pending.
        await ctx.outbox.markPublished(["pub-old"]);

        // Cutoff well after both entries — the published one is eligible,
        // the unpublished one must be untouched regardless of its age.
        await ctx.outbox.deletePublished(t3);

        const remaining = (await ctx.loadAll()).map((e) => e.id).sort();
        expect(remaining).toEqual(["unpub-old"]);
      });
    });
  });
}
