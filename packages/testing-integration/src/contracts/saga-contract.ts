import type { SagaPersistence } from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

export interface SagaContractContext {
  saga: SagaPersistence;
  cleanup?: () => Promise<void>;
}

export type SagaContractFactory = () =>
  | SagaContractContext
  | Promise<SagaContractContext>;

export function defineSagaContract(
  adapterLabel: string,
  factory: SagaContractFactory,
): void {
  describe(`SagaContract: ${adapterLabel}`, () => {
    let ctx: SagaContractContext;
    beforeEach(async () => {
      ctx = await factory();
    });
    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it("returns null for an unknown saga instance", async () => {
      const loaded = await ctx.saga.load("OrderSaga", "missing");
      expect(loaded).toBeNull();
    });

    it("saves and loads saga state and version", async () => {
      await ctx.saga.save("OrderSaga", "s-1", { step: 2, status: "active" }, 0);
      expect(await ctx.saga.load("OrderSaga", "s-1")).toEqual({
        state: { step: 2, status: "active" },
        version: 1,
      });
    });

    it("overwrites saga state on subsequent saves with correct versions", async () => {
      await ctx.saga.save("OrderSaga", "s-2", { step: 1 }, 0);
      await ctx.saga.save("OrderSaga", "s-2", { step: 5 }, 1);
      expect(await ctx.saga.load("OrderSaga", "s-2")).toEqual({
        state: { step: 5 },
        version: 2,
      });
    });

    it("isolates saga state across different saga names with the same id", async () => {
      await ctx.saga.save("A", "shared", { which: "a" }, 0);
      await ctx.saga.save("B", "shared", { which: "b" }, 0);
      expect(await ctx.saga.load("A", "shared")).toEqual({
        state: { which: "a" },
        version: 1,
      });
      expect(await ctx.saga.load("B", "shared")).toEqual({
        state: { which: "b" },
        version: 1,
      });
    });

    it("throws ConcurrencyError on a stale expectedVersion", async () => {
      await ctx.saga.save("OrderSaga", "s-3", { step: 1 }, 0);
      await ctx.saga.save("OrderSaga", "s-3", { step: 2 }, 1);
      await expect(
        ctx.saga.save("OrderSaga", "s-3", { step: 3 }, 1),
      ).rejects.toBeInstanceOf(ConcurrencyError);
    });
  });
}
