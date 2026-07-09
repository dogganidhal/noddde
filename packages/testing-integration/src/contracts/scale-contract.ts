import type {
  EventSourcedAggregatePersistence,
  OutboxEntry,
  OutboxStore,
} from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { slowTestsEnabled } from "../utils.js";

/**
 * Context for the scale smoke suite. Only the append/read persistences that
 * have untested high-volume paths are needed.
 */
export interface ScaleContractContext {
  eventSourced: EventSourcedAggregatePersistence;
  outbox: OutboxStore;
  cleanup?: () => Promise<void>;
}

export type ScaleContractFactory = () =>
  | ScaleContractContext
  | Promise<ScaleContractContext>;

// Volume knobs. Kept as named constants so the budgets below read clearly.
const OUTBOX_ENTRIES = 10_000;
const MARK_SAMPLE = 1_000;
const AGGREGATE_EVENTS = 100_000;
const SAVE_BATCH = 5_000;

// Time budgets are an order-of-magnitude sanity ceiling, NOT a benchmark —
// they exist to catch accidental O(n^2) regressions, not to assert
// performance. Generous on purpose because this runs nightly on shared CI.
const LOAD_UNPUBLISHED_BUDGET_MS = 30_000;
const MARK_PUBLISHED_BUDGET_MS = 30_000;
const AGGREGATE_LOAD_BUDGET_MS = 60_000;

// Per-test Vitest timeouts. These must comfortably exceed *setup + budget*:
// the budget above measures only the operation under test, but the `it`
// timeout also has to cover inserting 10k/100k rows first. Adapter
// integration configs set `testTimeout: 30_000`, which is far too tight for
// this suite, so each test overrides it explicitly.
const OUTBOX_TEST_TIMEOUT_MS = 120_000;
const AGGREGATE_TEST_TIMEOUT_MS = 240_000;

/**
 * High-volume smoke tests for the code paths the normal contract caps at a
 * handful of rows (ROBUSTNESS.md §2.3):
 *
 * - `loadUnpublished(10000)` — the batch size `markPublishedByEventIds`
 *   uses internally, never exercised elsewhere.
 * - `markPublishedByEventIds` over 10k unpublished entries — the adapters
 *   load-all-then-filter-in-JS, which is O(n) memory.
 * - `EventSourcedAggregatePersistence.load()` of a 100k-event stream — no
 *   pagination exists, so a large aggregate is a blind spot.
 *
 * Gated behind `NODDDE_SLOW_TESTS=1` (the nightly workflow sets it); skipped
 * in PR CI to keep latency low. Wire for one PG-backed adapter — that's
 * enough to catch algorithmic regressions.
 */
export function defineScaleContract(
  adapterLabel: string,
  factory: ScaleContractFactory,
): void {
  describe.skipIf(!slowTestsEnabled())(`ScaleContract: ${adapterLabel}`, () => {
    let ctx: ScaleContractContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it(
      `loadUnpublished(${OUTBOX_ENTRIES}) returns every entry within budget`,
      async () => {
        for (let start = 0; start < OUTBOX_ENTRIES; start += SAVE_BATCH) {
          const batch: OutboxEntry[] = [];
          for (let i = start; i < start + SAVE_BATCH; i++) {
            batch.push({
              id: `e-${i}`,
              event: { name: "E", payload: { i } },
              createdAt: new Date(2024, 0, 1, 0, 0, 0, i),
              publishedAt: null,
            });
          }
          await ctx.outbox.save(batch);
        }

        const started = Date.now();
        const loaded = await ctx.outbox.loadUnpublished(OUTBOX_ENTRIES);
        const elapsed = Date.now() - started;

        expect(loaded).toHaveLength(OUTBOX_ENTRIES);
        expect(elapsed).toBeLessThan(LOAD_UNPUBLISHED_BUDGET_MS);
      },
      OUTBOX_TEST_TIMEOUT_MS,
    );

    it(
      `markPublishedByEventIds over ${OUTBOX_ENTRIES} entries marks exactly the targeted ${MARK_SAMPLE}`,
      async () => {
        for (let start = 0; start < OUTBOX_ENTRIES; start += SAVE_BATCH) {
          const batch: OutboxEntry[] = [];
          for (let i = start; i < start + SAVE_BATCH; i++) {
            batch.push({
              id: `e-${i}`,
              event: {
                name: "E",
                payload: { i },
                metadata: {
                  eventId: `evt-${i}`,
                  timestamp: "2024-01-01T00:00:00.000Z",
                  correlationId: "c",
                  causationId: "cmd",
                },
              },
              createdAt: new Date(2024, 0, 1, 0, 0, 0, i),
              publishedAt: null,
            });
          }
          await ctx.outbox.save(batch);
        }

        // Deterministic spread of 1k ids across the 10k range (every 10th).
        const targetEventIds = Array.from(
          { length: MARK_SAMPLE },
          (_, k) => `evt-${k * (OUTBOX_ENTRIES / MARK_SAMPLE)}`,
        );

        const started = Date.now();
        await ctx.outbox.markPublishedByEventIds(targetEventIds);
        const elapsed = Date.now() - started;

        const stillUnpublished =
          await ctx.outbox.loadUnpublished(OUTBOX_ENTRIES);
        expect(stillUnpublished).toHaveLength(OUTBOX_ENTRIES - MARK_SAMPLE);
        expect(elapsed).toBeLessThan(MARK_PUBLISHED_BUDGET_MS);
      },
      OUTBOX_TEST_TIMEOUT_MS,
    );

    it(
      `load() of a ${AGGREGATE_EVENTS}-event aggregate completes within budget`,
      async () => {
        let version = 0;
        for (let start = 0; start < AGGREGATE_EVENTS; start += SAVE_BATCH) {
          const batch = Array.from({ length: SAVE_BATCH }, (_, k) => ({
            name: "Appended",
            payload: { seq: start + k },
          }));
          await ctx.eventSourced.save("BigStream", "agg-1", batch, version);
          version += batch.length;
        }

        const started = Date.now();
        const events = await ctx.eventSourced.load("BigStream", "agg-1");
        const elapsed = Date.now() - started;

        expect(events).toHaveLength(AGGREGATE_EVENTS);
        expect(elapsed).toBeLessThan(AGGREGATE_LOAD_BUDGET_MS);
      },
      AGGREGATE_TEST_TIMEOUT_MS,
    );
  });
}
