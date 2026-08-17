import type {
  EventSourcedAggregatePersistence,
  PartialEventLoad,
  StateStoredAggregatePersistence,
} from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

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

    describe("concurrency", () => {
      // The existing optimistic-concurrency tests race two saves
      // *sequentially* (save, then a second save with a stale
      // expectedVersion). This exercises the genuinely concurrent path:
      // two save() calls to the same stream at the same expectedVersion,
      // fired without awaiting between them. Exactly one must win; the
      // loser must reject with ConcurrencyError (proving the unique
      // constraint on (aggregate, version) is what arbitrates, not luck).
      //
      // Looped a handful of times because a race only surfaces reliably
      // under repetition — a single pass can let one call fully commit
      // before the other reaches the database.
      it("rejects with ConcurrencyError when two save() calls race on the same stream", async () => {
        for (let i = 0; i < 10; i++) {
          const id = `o-race-${i}`;
          const results = await Promise.allSettled([
            ctx.eventSourced.save(
              "Order",
              id,
              [{ name: "OrderPlaced", payload: { by: "A" } }],
              0,
            ),
            ctx.eventSourced.save(
              "Order",
              id,
              [{ name: "OrderPlaced", payload: { by: "B" } }],
              0,
            ),
          ]);

          const fulfilled = results.filter((r) => r.status === "fulfilled");
          const rejected = results.filter(
            (r): r is PromiseRejectedResult => r.status === "rejected",
          );
          expect(fulfilled).toHaveLength(1);
          expect(rejected).toHaveLength(1);
          expect(rejected[0]?.reason).toBeInstanceOf(ConcurrencyError);

          // The winner's single event is the only one persisted at v1.
          const loaded = await ctx.eventSourced.load("Order", id);
          expect(loaded).toHaveLength(1);
          expect(loaded[0]?.name).toBe("OrderPlaced");
        }
      });

      it("rejects with ConcurrencyError when two state-stored saves race on the same aggregate", async () => {
        for (let i = 0; i < 10; i++) {
          const id = `a-race-${i}`;
          const results = await Promise.allSettled([
            ctx.stateStored.save("Account", id, { balance: 1 }, 0),
            ctx.stateStored.save("Account", id, { balance: 2 }, 0),
          ]);

          const fulfilled = results.filter((r) => r.status === "fulfilled");
          const rejected = results.filter(
            (r): r is PromiseRejectedResult => r.status === "rejected",
          );
          expect(fulfilled).toHaveLength(1);
          expect(rejected).toHaveLength(1);
          expect(rejected[0]?.reason).toBeInstanceOf(ConcurrencyError);

          const loaded = await ctx.stateStored.load("Account", id);
          expect(loaded?.version).toBe(1);
        }
      });
    });

    // The framework's payload contract is "any JSON-serializable value".
    // A single hard-coded Unicode case can't prove that; a property-based
    // sweep over structurally-arbitrary JSON documents can. These tests
    // also pin down the *boundaries* of the contract — the shapes that are
    // NOT JSON-serializable (BigInt, circular) must surface a clear error
    // rather than silently corrupting the stream. See
    // `docs/content/docs/persistence/payload-shapes.mdx`.
    describe("JSON payload edge cases", () => {
      // Strings (and object keys) are drawn explicitly from printable ASCII
      // (0x20–0x7e). `fc.string()` on its own generates arbitrary Unicode
      // including control bytes and lone surrogates, which would let this
      // sweep overlap the explicit NUL / encoding edge-case tests below and
      // flake per-dialect. Constraining the alphabet keeps the property
      // dialect-agnostic; the sharp characters get their own dedicated cases.
      const printableAscii = fc
        .array(fc.integer({ min: 0x20, max: 0x7e }), { maxLength: 24 })
        .map((codes) => String.fromCharCode(...codes));

      // Recursive generator of JSON-safe values. Doubles exclude NaN and
      // Infinity, which `JSON.stringify` turns into `null` (a corruption the
      // property would otherwise trip over).
      const jsonSafeValue = fc.letrec<{ value: unknown }>((tie) => ({
        value: fc.oneof(
          { depthSize: "small" },
          fc.constant(null),
          fc.boolean(),
          fc.integer(),
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          printableAscii,
          fc.array(tie("value"), { maxLength: 6 }),
          fc.dictionary(printableAscii, tie("value"), { maxKeys: 6 }),
        ),
      })).value;

      it("roundtrips arbitrary JSON-serializable payloads (property-based)", async () => {
        let n = 0;
        await fc.assert(
          fc.asyncProperty(jsonSafeValue, async (value) => {
            const id = `o-fc-${n++}`;
            const payload = { value };
            await ctx.eventSourced.save(
              "Order",
              id,
              [{ name: "E", payload }],
              0,
            );
            const [loaded] = await ctx.eventSourced.load("Order", id);
            // -0 is not JSON-representable (JSON.stringify(-0) === "0"), so
            // it comes back as +0 — normalize the expectation through the
            // same JSON round-trip rather than comparing against the raw
            // generated payload.
            expect(loaded?.payload).toEqual(
              JSON.parse(JSON.stringify(payload)),
            );
          }),
          { numRuns: 40 },
        );
      });

      it("roundtrips floating-point values without precision loss", async () => {
        const payload = {
          classic: 0.1 + 0.2, // 0.30000000000000004
          maxSafe: Number.MAX_SAFE_INTEGER,
          tiny: 5e-324,
          large: 1.7976931348623157e308,
          negZero: -0,
        };
        await ctx.eventSourced.save(
          "Order",
          "o-float",
          [{ name: "E", payload }],
          0,
        );
        const [loaded] = await ctx.eventSourced.load("Order", "o-float");
        // -0 is not JSON-representable and comes back as 0; assert the rest
        // survive bit-for-bit.
        expect(loaded?.payload).toMatchObject({
          classic: 0.1 + 0.2,
          maxSafe: Number.MAX_SAFE_INTEGER,
          tiny: 5e-324,
          large: 1.7976931348623157e308,
        });
      });

      it("stores a large (~1MB) string payload without silently truncating it", async () => {
        // Backends diverge on capacity: jsonb / json / unbounded text hold a
        // megabyte fine, but a fixed `TEXT` column (TypeORM on MySQL caps at
        // 64KB) raises "Data too long". Either is acceptable — a loud error
        // or a lossless round-trip. What's forbidden is a save that
        // "succeeds" but silently truncates the payload.
        const big = "x".repeat(1_000_000);
        try {
          await ctx.eventSourced.save(
            "Order",
            "o-big",
            [{ name: "E", payload: { big } }],
            0,
          );
        } catch {
          // A clear capacity error is fine; nothing should be persisted.
          expect(await ctx.eventSourced.load("Order", "o-big")).toEqual([]);
          return;
        }
        const [loaded] = await ctx.eventSourced.load("Order", "o-big");
        expect((loaded?.payload as { big: string }).big).toHaveLength(
          1_000_000,
        );
      });

      it("surfaces a clear error for BigInt payloads instead of corrupting the stream", async () => {
        await expect(
          ctx.eventSourced.save(
            "Order",
            "o-bigint",
            // BigInt is not JSON-serializable — JSON.stringify throws.
            [{ name: "E", payload: { n: 1n } as unknown as object }],
            0,
          ),
        ).rejects.toThrow();
        // Nothing was partially persisted.
        expect(await ctx.eventSourced.load("Order", "o-bigint")).toEqual([]);
      });

      it("surfaces a clear error for circular references", async () => {
        const circular: Record<string, unknown> = { a: 1 };
        circular.self = circular;
        await expect(
          ctx.eventSourced.save(
            "Order",
            "o-circular",
            [{ name: "E", payload: circular }],
            0,
          ),
        ).rejects.toThrow();
        expect(await ctx.eventSourced.load("Order", "o-circular")).toEqual([]);
      });

      it("never silently corrupts a NUL byte embedded in a string payload", async () => {
        // Build the NUL explicitly so the source file stays free of raw
        // control bytes. Backends diverge here: Postgres `text` rejects a
        // NUL outright, some column types round-trip it, others could strip
        // it. The one outcome the contract forbids is silent corruption —
        // a save that "succeeds" but loses the byte. So: either the save
        // rejects (a clear, catchable failure) or the value comes back
        // byte-for-byte.
        const original = `before${String.fromCharCode(0)}after`;
        try {
          await ctx.eventSourced.save(
            "Order",
            "o-nul",
            [{ name: "E", payload: { s: original } }],
            0,
          );
        } catch {
          // Rejecting is an acceptable, non-silent failure mode.
          expect(await ctx.eventSourced.load("Order", "o-nul")).toEqual([]);
          return;
        }
        const [loaded] = await ctx.eventSourced.load("Order", "o-nul");
        expect((loaded?.payload as { s: string }).s).toBe(original);
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
