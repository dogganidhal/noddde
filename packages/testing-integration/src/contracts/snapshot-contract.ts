import type { SnapshotStore } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

export interface SnapshotContractContext {
  snapshots: SnapshotStore;
  cleanup?: () => Promise<void>;
}

export type SnapshotContractFactory = () =>
  | SnapshotContractContext
  | Promise<SnapshotContractContext>;

export function defineSnapshotContract(
  adapterLabel: string,
  factory: SnapshotContractFactory,
): void {
  describe(`SnapshotContract: ${adapterLabel}`, () => {
    let ctx: SnapshotContractContext;
    beforeEach(async () => {
      ctx = await factory();
    });
    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it("returns null for an unknown aggregate", async () => {
      expect(await ctx.snapshots.load("Order", "missing")).toBeNull();
    });

    it("saves and loads a snapshot with its version", async () => {
      await ctx.snapshots.save("Order", "o-1", {
        state: { status: "confirmed", total: 100 },
        version: 5,
      });
      expect(await ctx.snapshots.load("Order", "o-1")).toEqual({
        state: { status: "confirmed", total: 100 },
        version: 5,
      });
    });

    it("overwrites a snapshot on repeated saves", async () => {
      await ctx.snapshots.save("Order", "o-2", {
        state: { status: "placed" },
        version: 1,
      });
      await ctx.snapshots.save("Order", "o-2", {
        state: { status: "shipped" },
        version: 3,
      });
      expect(await ctx.snapshots.load("Order", "o-2")).toEqual({
        state: { status: "shipped" },
        version: 3,
      });
    });
  });
}
