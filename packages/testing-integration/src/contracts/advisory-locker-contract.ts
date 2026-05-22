import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sleep } from "../utils.js";

export interface AdvisoryLockerContractContext {
  /** First locker (typically a fresh connection/session). */
  lockerA: AggregateLocker;
  /** Second locker on a *different* session, used to test cross-session blocking. */
  lockerB: AggregateLocker;
  cleanup?: () => Promise<void>;
}

export type AdvisoryLockerContractFactory = () =>
  | AdvisoryLockerContractContext
  | Promise<AdvisoryLockerContractContext>;

/**
 * Pessimistic-locking contract for database-backed advisory lockers.
 * Two distinct sessions are required because most advisory-lock APIs
 * (`pg_advisory_lock`, MySQL `GET_LOCK`) are session-scoped and would
 * trivially "succeed" if the same connection held the lock twice.
 */
export function defineAdvisoryLockerContract(
  adapterLabel: string,
  factory: AdvisoryLockerContractFactory,
): void {
  describe(`AdvisoryLockerContract: ${adapterLabel}`, () => {
    let ctx: AdvisoryLockerContractContext;
    beforeEach(async () => {
      ctx = await factory();
    });
    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it("acquire/release roundtrips on a single session", async () => {
      await ctx.lockerA.acquire("Order", "o-1");
      await ctx.lockerA.release("Order", "o-1");
      // Re-acquire after release must succeed
      await ctx.lockerA.acquire("Order", "o-1", 1000);
      await ctx.lockerA.release("Order", "o-1");
    });

    it("a second session blocks while the first holds the lock", async () => {
      await ctx.lockerA.acquire("Order", "o-2");
      let resolvedAt: number | null = null;
      const second = ctx.lockerB.acquire("Order", "o-2", 5000).then(() => {
        resolvedAt = Date.now();
      });

      await sleep(150);
      expect(resolvedAt).toBeNull(); // still blocked

      await ctx.lockerA.release("Order", "o-2");
      await second;
      expect(resolvedAt).not.toBeNull();
      await ctx.lockerB.release("Order", "o-2");
    });

    it("throws LockTimeoutError when timeout elapses with the lock held by another session", async () => {
      await ctx.lockerA.acquire("Order", "o-3");
      await expect(
        ctx.lockerB.acquire("Order", "o-3", 250),
      ).rejects.toBeInstanceOf(LockTimeoutError);
      await ctx.lockerA.release("Order", "o-3");
    });

    it("isolates locks across different aggregate names + ids", async () => {
      await ctx.lockerA.acquire("Order", "id");
      // Different (name, id) should be acquirable immediately by the other session
      await ctx.lockerB.acquire("Payment", "id", 500);
      await ctx.lockerA.release("Order", "id");
      await ctx.lockerB.release("Payment", "id");
    });
  });
}
