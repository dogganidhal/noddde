import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  UnitOfWorkFactory,
} from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
  });
}
