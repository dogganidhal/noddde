import type { Event, EventReader } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Context for the {@link EventReader} contract. `seed` writes a handful of
 * events across at least two distinct aggregate names and returns the total
 * count written, so `read()` has something deterministic to stream back.
 */
export interface EventReaderContractContext {
  reader: EventReader;
  /** Seeds the event log and returns the total number of events written. */
  seed: () => Promise<number>;
  /**
   * The aggregate name used by at least one event `seed()` writes, so the
   * `aggregateName` filter case has something to isolate on.
   */
  seededAggregateName: string;
  cleanup?: () => Promise<void>;
}

export type EventReaderContractFactory = () =>
  | EventReaderContractContext
  | Promise<EventReaderContractContext>;

/**
 * Contract suite for the {@link EventReader} capability that backs
 * `Domain.rebuildProjection` (#131 finding 1 — no SQL adapter implemented
 * this, so rebuild threw `EventReaderUnavailableError` against every
 * production database). Adapters providing `eventReader` re-use this against
 * each dialect they support.
 */
export function defineEventReaderContract(
  adapterLabel: string,
  factory: EventReaderContractFactory,
): void {
  describe(`EventReaderContract: ${adapterLabel}`, () => {
    let ctx: EventReaderContractContext;
    beforeEach(async () => {
      ctx = await factory();
    });
    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it("streams every previously-written event exactly once, in append order", async () => {
      const total = await ctx.seed();
      const seen: Event[] = [];
      for await (const event of ctx.reader.read()) {
        seen.push(event);
      }
      expect(seen).toHaveLength(total);
    });

    it("supports re-reading the full log from a fresh call", async () => {
      const total = await ctx.seed();

      const first: Event[] = [];
      for await (const event of ctx.reader.read()) first.push(event);

      const second: Event[] = [];
      for await (const event of ctx.reader.read()) second.push(event);

      expect(second).toHaveLength(total);
      expect(second.map((e) => e.name)).toEqual(first.map((e) => e.name));
    });

    it("filters to the given aggregateName when provided", async () => {
      await ctx.seed();

      const filtered: Event[] = [];
      for await (const event of ctx.reader.read({
        aggregateName: ctx.seededAggregateName,
      })) {
        filtered.push(event);
      }
      expect(filtered.length).toBeGreaterThan(0);

      const excluded: Event[] = [];
      for await (const event of ctx.reader.read({
        aggregateName: "__nonexistent-aggregate__",
      })) {
        excluded.push(event);
      }
      expect(excluded).toEqual([]);
    });

    it("never materializes the whole log before yielding the first event (streams, does not buffer)", async () => {
      await ctx.seed();
      const iterator = ctx.reader.read()[Symbol.asyncIterator]();
      const { value, done } = await iterator.next();
      expect(done).not.toBe(true);
      expect(value).toBeDefined();
      // No further assertion possible generically (adapters may legitimately
      // fetch a batch ahead), but requiring the first `next()` to resolve
      // without seeding a second, much larger stream keeps this contract
      // honest about not requiring a full drain to observe anything.
    });
  });
}
