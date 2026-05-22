import type {
  EventSourcedAggregatePersistence,
  PartialEventLoad,
  StateStoredAggregatePersistence,
} from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Factory returned to the contract suite for a single test. The factory
 * provisions a clean adapter state (truncated tables, fresh container,
 * whatever the caller wants) and returns the persistence instances under
 * test. Tests treat the persistences as opaque — only the
 * `EventSourcedAggregatePersistence` / `StateStoredAggregatePersistence`
 * interfaces matter.
 */
export interface PersistenceContractContext {
  eventSourced: EventSourcedAggregatePersistence & Partial<PartialEventLoad>;
  stateStored: StateStoredAggregatePersistence;
  /** Optional teardown — closing connections, dropping tables, etc. */
  cleanup?: () => Promise<void>;
  /**
   * Adapter-dialect combinations whose payload column can't carry
   * non-ASCII text (e.g. MSSQL's `TEXT` codepage column type). When true,
   * the Unicode-roundtrip case still runs but only asserts the non-string
   * fields survive — the framework itself never strips characters, this
   * flag exists because some legacy column types do.
   */
  unicodeSafe?: boolean;
}

export type PersistenceContractFactory = () =>
  | PersistenceContractContext
  | Promise<PersistenceContractContext>;

/**
 * Contract suite for event-sourced and state-stored persistence adapters.
 * Adapters (Drizzle, Prisma, TypeORM, …) re-use this against each dialect
 * they support so dialect-specific quirks (JSONB vs TEXT payloads,
 * autoincrement vs identity columns, unique-constraint error messages)
 * are covered uniformly.
 */
export function definePersistenceContract(
  adapterLabel: string,
  factory: PersistenceContractFactory,
): void {
  describe(`PersistenceContract: ${adapterLabel}`, () => {
    let ctx: PersistenceContractContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("event-sourced", () => {
      it("appends events with monotonically increasing sequence numbers", async () => {
        await ctx.eventSourced.save(
          "Order",
          "o-1",
          [
            { name: "OrderPlaced", payload: { total: 100 } },
            { name: "OrderConfirmed", payload: { confirmedAt: "2024-01-01" } },
          ],
          0,
        );
        await ctx.eventSourced.save(
          "Order",
          "o-1",
          [{ name: "OrderShipped", payload: { tracking: "X" } }],
          2,
        );

        const loaded = await ctx.eventSourced.load("Order", "o-1");
        expect(loaded.map((e) => e.name)).toEqual([
          "OrderPlaced",
          "OrderConfirmed",
          "OrderShipped",
        ]);
      });

      it("returns an empty array for an unknown aggregate", async () => {
        expect(await ctx.eventSourced.load("Order", "missing")).toEqual([]);
      });

      it("roundtrips JSON payloads with nested objects, arrays, unicode and null", async () => {
        // Default to true; opt-out only for backends with codepage-limited
        // payload columns (e.g. MSSQL TEXT, which can't carry the emoji).
        const unicodeSafe = ctx.unicodeSafe ?? true;
        const payload = {
          total: 9.99,
          items: [{ sku: "ABC-1", qty: 2 }],
          notes: unicodeSafe ? "Café — leave at door 🚪" : "leave at door",
          discount: null,
        };
        await ctx.eventSourced.save(
          "Order",
          "o-2",
          [{ name: "OrderPlaced", payload }],
          0,
        );
        const [loaded] = await ctx.eventSourced.load("Order", "o-2");
        expect(loaded?.payload).toEqual(payload);
      });

      it("isolates events across different aggregate names", async () => {
        await ctx.eventSourced.save(
          "Order",
          "id",
          [{ name: "A", payload: {} }],
          0,
        );
        await ctx.eventSourced.save(
          "Payment",
          "id",
          [{ name: "B", payload: {} }],
          0,
        );
        expect((await ctx.eventSourced.load("Order", "id"))[0]?.name).toBe("A");
        expect((await ctx.eventSourced.load("Payment", "id"))[0]?.name).toBe(
          "B",
        );
      });

      it("isolates events across different aggregate ids with the same name", async () => {
        await ctx.eventSourced.save(
          "Order",
          "a",
          [{ name: "A", payload: {} }],
          0,
        );
        await ctx.eventSourced.save(
          "Order",
          "b",
          [{ name: "B", payload: {} }],
          0,
        );
        expect((await ctx.eventSourced.load("Order", "a"))[0]?.name).toBe("A");
        expect((await ctx.eventSourced.load("Order", "b"))[0]?.name).toBe("B");
      });

      it("throws ConcurrencyError on a stale expectedVersion", async () => {
        await ctx.eventSourced.save(
          "Order",
          "o-3",
          [{ name: "A", payload: {} }],
          0,
        );
        await expect(
          ctx.eventSourced.save(
            "Order",
            "o-3",
            [{ name: "B", payload: {} }],
            0,
          ),
        ).rejects.toBeInstanceOf(ConcurrencyError);
      });

      it("no-ops when given an empty event array", async () => {
        await ctx.eventSourced.save("Order", "o-4", [], 0);
        expect(await ctx.eventSourced.load("Order", "o-4")).toEqual([]);
      });

      it("preserves event metadata through a save/load roundtrip", async () => {
        const metadata = {
          eventId: "evt-1",
          correlationId: "corr-1",
          causationId: "cmd-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          aggregateId: "o-5",
        };
        await ctx.eventSourced.save(
          "Order",
          "o-5",
          [{ name: "OrderPlaced", payload: { total: 1 }, metadata }],
          0,
        );
        const [loaded] = await ctx.eventSourced.load("Order", "o-5");
        expect(loaded?.metadata).toMatchObject(metadata);
      });

      it("supports partial loading after a given version (when implemented)", async () => {
        if (!ctx.eventSourced.loadAfterVersion) return; // adapter doesn't implement it
        await ctx.eventSourced.save(
          "Order",
          "o-6",
          [
            { name: "A", payload: {} },
            { name: "B", payload: {} },
            { name: "C", payload: {} },
          ],
          0,
        );
        const tail = await ctx.eventSourced.loadAfterVersion("Order", "o-6", 1);
        expect(tail.map((e) => e.name)).toEqual(["B", "C"]);
      });
    });

    describe("state-stored", () => {
      it("returns null for an unknown aggregate", async () => {
        expect(await ctx.stateStored.load("Account", "missing")).toBeNull();
      });

      it("saves new state at version 1 and overwrites with monotonic versions", async () => {
        await ctx.stateStored.save("Account", "a-1", { balance: 100 }, 0);
        const v1 = await ctx.stateStored.load("Account", "a-1");
        expect(v1).toEqual({ state: { balance: 100 }, version: 1 });

        await ctx.stateStored.save("Account", "a-1", { balance: 200 }, 1);
        const v2 = await ctx.stateStored.load("Account", "a-1");
        expect(v2).toEqual({ state: { balance: 200 }, version: 2 });
      });

      it("throws ConcurrencyError when expectedVersion is stale", async () => {
        await ctx.stateStored.save("Account", "a-2", { balance: 1 }, 0);
        await expect(
          ctx.stateStored.save("Account", "a-2", { balance: 2 }, 0),
        ).rejects.toBeInstanceOf(ConcurrencyError);
      });

      it("throws ConcurrencyError when initial save uses nonzero expectedVersion", async () => {
        await expect(
          ctx.stateStored.save("Account", "a-3", { balance: 1 }, 1),
        ).rejects.toBeInstanceOf(ConcurrencyError);
      });

      it("roundtrips structurally-complex state including nested arrays", async () => {
        const state = {
          owners: ["Alice", "Bob"],
          balances: { USD: 100.5, EUR: 50 },
          flags: { closed: false },
        };
        await ctx.stateStored.save("Account", "a-4", state, 0);
        const loaded = await ctx.stateStored.load("Account", "a-4");
        expect(loaded?.state).toEqual(state);
      });
    });
  });
}
