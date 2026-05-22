import type { SagaPersistence } from "@noddde/core";
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

    it("returns null/undefined for an unknown saga instance", async () => {
      const loaded = await ctx.saga.load("OrderSaga", "missing");
      expect(loaded == null).toBe(true);
    });

    it("saves and loads saga state", async () => {
      await ctx.saga.save("OrderSaga", "s-1", { step: 2, status: "active" });
      expect(await ctx.saga.load("OrderSaga", "s-1")).toEqual({
        step: 2,
        status: "active",
      });
    });

    it("overwrites saga state on subsequent saves", async () => {
      await ctx.saga.save("OrderSaga", "s-2", { step: 1 });
      await ctx.saga.save("OrderSaga", "s-2", { step: 5 });
      expect(await ctx.saga.load("OrderSaga", "s-2")).toEqual({ step: 5 });
    });

    it("isolates saga state across different saga names with the same id", async () => {
      await ctx.saga.save("A", "shared", { which: "a" });
      await ctx.saga.save("B", "shared", { which: "b" });
      expect(await ctx.saga.load("A", "shared")).toEqual({ which: "a" });
      expect(await ctx.saga.load("B", "shared")).toEqual({ which: "b" });
    });
  });
}
