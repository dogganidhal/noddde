import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  UnitOfWorkFactory,
} from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sleep } from "../utils.js";

export interface UnitOfWorkContractContext {
  eventSourced: EventSourcedAggregatePersistence;
  stateStored: StateStoredAggregatePersistence;
  uowFactory: UnitOfWorkFactory;
  cleanup?: () => Promise<void>;
}

export type UnitOfWorkContractFactory = () =>
  | UnitOfWorkContractContext
  | Promise<UnitOfWorkContractContext>;

/**
 * Exercises the transaction guarantees the UoW must provide: commit makes
 * all enlisted writes visible atomically, rollback (or a thrown enlisted
 * op) leaves the store untouched, sealed UoWs reject re-use, and
 * deferPublish returns events only on success.
 */
export function defineUnitOfWorkContract(
  adapterLabel: string,
  factory: UnitOfWorkContractFactory,
): void {
  describe(`UnitOfWorkContract: ${adapterLabel}`, () => {
    let ctx: UnitOfWorkContractContext;
    beforeEach(async () => {
      ctx = await factory();
    });
    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it("commit persists all enlisted operations atomically", async () => {
      const uow = ctx.uowFactory();
      uow.enlist(() =>
        ctx.eventSourced.save(
          "Order",
          "o-1",
          [{ name: "OrderPlaced", payload: { total: 50 } }],
          0,
        ),
      );
      uow.enlist(() =>
        ctx.stateStored.save("Account", "a-1", { balance: 50 }, 0),
      );
      const events = await uow.commit();

      expect(events).toEqual([]); // no deferPublish called
      expect((await ctx.eventSourced.load("Order", "o-1"))[0]?.name).toBe(
        "OrderPlaced",
      );
      expect((await ctx.stateStored.load("Account", "a-1"))?.version).toBe(1);
    });

    it("deferPublish returns events after a successful commit", async () => {
      const uow = ctx.uowFactory();
      uow.deferPublish(
        { name: "OrderPlaced", payload: { total: 1 } },
        { name: "OrderConfirmed", payload: {} },
      );
      const published = await uow.commit();
      expect(published.map((e) => e.name)).toEqual([
        "OrderPlaced",
        "OrderConfirmed",
      ]);
    });

    it("rollback discards both writes and deferred events", async () => {
      const uow = ctx.uowFactory();
      uow.enlist(() =>
        ctx.eventSourced.save(
          "Order",
          "rb-1",
          [{ name: "OrderPlaced", payload: {} }],
          0,
        ),
      );
      uow.deferPublish({ name: "OrderPlaced", payload: {} });
      await uow.rollback();

      expect(await ctx.eventSourced.load("Order", "rb-1")).toEqual([]);
    });

    it("a throwing enlisted op aborts the transaction (no partial writes)", async () => {
      const uow = ctx.uowFactory();
      uow.enlist(() =>
        ctx.eventSourced.save(
          "Order",
          "tx-1",
          [{ name: "OrderPlaced", payload: {} }],
          0,
        ),
      );
      uow.enlist(async () => {
        throw new Error("boom");
      });

      await expect(uow.commit()).rejects.toThrow(/boom/);
      // The first op must NOT be visible — true atomicity.
      expect(await ctx.eventSourced.load("Order", "tx-1")).toEqual([]);
    });

    it("any operation on a sealed UnitOfWork throws", async () => {
      const uow = ctx.uowFactory();
      await uow.commit();
      expect(() => uow.enlist(async () => {})).toThrow(/completed/i);
      expect(() => uow.deferPublish()).toThrow(/completed/i);
      await expect(uow.commit()).rejects.toThrow(/completed/i);
      await expect(uow.rollback()).rejects.toThrow(/completed/i);
    });

    it("exposes a non-undefined transaction context while operations run", async () => {
      const uow = ctx.uowFactory();
      let observed: unknown = null;
      uow.enlist(async () => {
        observed = uow.context;
      });
      expect(uow.context).toBeUndefined();
      await uow.commit();
      expect(observed).toBeDefined();
      expect(observed).not.toBeNull();
      expect(uow.context).toBeUndefined();
    });

    // Regression coverage for the #129 finding 1 BLOCKER: the active
    // transaction used to live in a single mutable field shared by every
    // persistence instance (`txStore.current = tx`), so a second UoW
    // committing while a first UoW's enlisted operations were still
    // in-flight would silently redirect the first UoW's later writes onto
    // the second UoW's transaction — including its rollback. These two
    // tests reproduce that exact interleaving and must pass on an
    // AsyncLocalStorage-backed (or equivalent per-call-context) executor.
    describe("concurrent unit-of-work isolation", () => {
      it("two unit-of-work commits interleaved in time do not cross-contaminate each other's writes", async () => {
        const uowA = ctx.uowFactory();
        const uowB = ctx.uowFactory();

        // uowA's second op is delayed so uowB's commit interleaves in the
        // gap — the exact window where a shared mutable txStore would let
        // uowB's transaction overwrite uowA's for the remainder of uowA's op
        // loop.
        uowA.enlist(() =>
          ctx.eventSourced.save(
            "Order",
            "uow-a",
            [{ name: "First", payload: {} }],
            0,
          ),
        );
        uowA.enlist(async () => {
          await sleep(30);
          await ctx.eventSourced.save(
            "Order",
            "uow-a",
            [{ name: "Second", payload: {} }],
            1,
          );
        });

        uowB.enlist(() =>
          ctx.eventSourced.save(
            "Order",
            "uow-b",
            [{ name: "OnlyB", payload: {} }],
            0,
          ),
        );

        const commitA = uowA.commit();
        await sleep(5); // let uowA enter its transaction and start its op loop
        const commitB = uowB.commit();
        await Promise.all([commitA, commitB]);

        const aEvents = await ctx.eventSourced.load("Order", "uow-a");
        expect(aEvents.map((e) => e.name)).toEqual(["First", "Second"]);

        const bEvents = await ctx.eventSourced.load("Order", "uow-b");
        expect(bEvents.map((e) => e.name)).toEqual(["OnlyB"]);
      });

      it("a rollback in one unit-of-work does not roll back another unit-of-work's concurrently-committing writes", async () => {
        const uowKeep = ctx.uowFactory();
        const uowFail = ctx.uowFactory();

        uowKeep.enlist(() =>
          ctx.eventSourced.save(
            "Order",
            "uow-keep",
            [{ name: "First", payload: {} }],
            0,
          ),
        );
        uowKeep.enlist(async () => {
          await sleep(30);
          await ctx.eventSourced.save(
            "Order",
            "uow-keep",
            [{ name: "Second", payload: {} }],
            1,
          );
        });

        uowFail.enlist(async () => {
          throw new Error("boom");
        });

        const commitKeep = uowKeep.commit();
        await sleep(5); // interleave uowFail's rollback inside uowKeep's gap
        const commitFail = uowFail.commit();

        await expect(commitFail).rejects.toThrow(/boom/);
        await commitKeep;

        // The whole point: uowKeep's commit resolved successfully and BOTH
        // of its writes must be visible — a shared mutable txStore would let
        // uowFail's rollback silently discard uowKeep's in-flight write.
        const keepEvents = await ctx.eventSourced.load("Order", "uow-keep");
        expect(keepEvents.map((e) => e.name)).toEqual(["First", "Second"]);
      });
    });
  });
}
