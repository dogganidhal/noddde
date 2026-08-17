import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sleep } from "../utils.js";

export interface AdvisoryLockerContractContext {
  /** First locker (typically a fresh connection/session). */
  lockerA: AggregateLocker;
  /** Second locker on a *different* session, used to test cross-session blocking. */
  lockerB: AggregateLocker;
  /**
   * Optional hook that forcibly terminates lockerA's underlying database
   * session/connection *without* going through `release()` — the equivalent
   * of the holding process crashing. Database advisory locks
   * (`pg_advisory_lock`, MySQL `GET_LOCK`, MSSQL `sp_getapplock`) are
   * session-scoped and must be reclaimed by the server when the session
   * dies; this hook lets the contract prove that. When omitted, the
   * crash-recovery case is skipped for that adapter.
   */
  killSessionA?: () => Promise<void>;
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

    // The whole point of a database advisory lock is that it survives a
    // clean release *and* a dirty crash: if the process holding the lock
    // dies, the database must reclaim it so the system doesn't deadlock
    // forever. Every existing case releases explicitly; this one severs
    // session A's connection with the lock still held and proves session B
    // can then acquire it. Skipped for adapters that don't expose a
    // `killSessionA` hook.
    it("auto-releases the lock when the holding session is terminated without release()", async (t) => {
      // Skip (not silently pass) when the adapter didn't wire the kill hook,
      // so an omitted `killSessionA` shows up as skipped rather than green.
      t.skip(!ctx.killSessionA, "adapter did not provide killSessionA");
      await ctx.lockerA.acquire("Order", "o-crash");

      // Sanity check: while A holds it, B cannot acquire within a short
      // timeout — proves the lock is genuinely held before we kill A.
      await expect(
        ctx.lockerB.acquire("Order", "o-crash", 250),
      ).rejects.toBeInstanceOf(LockTimeoutError);

      // Kill A's session abruptly. No release() is called.
      await ctx.killSessionA!();

      // The server must have reclaimed the lock on session death, so B
      // now acquires it within the timeout.
      await ctx.lockerB.acquire("Order", "o-crash", 5000);
      await ctx.lockerB.release("Order", "o-crash");
    });

    // Regression coverage for the #131 finding 2 residual hole: PG/MySQL
    // advisory locks are session-scoped, not call-scoped, so a session
    // pinned for safe release (fromUrl / a dedicated QueryRunner) is still
    // re-entrant — two concurrent acquire() calls from the SAME locker
    // instance (one session) would both "succeed" without an in-process
    // mutex layered in front of the DB lock. This never crosses sessions
    // (lockerA only), so it exercises the composed local mutex specifically.
    it("serializes concurrent acquires from the same locker instance for the same key", async () => {
      let holders = 0;
      let maxConcurrentHolders = 0;
      const contend = async () => {
        await ctx.lockerA.acquire("Order", "o-reentrant", 2000);
        holders++;
        maxConcurrentHolders = Math.max(maxConcurrentHolders, holders);
        await sleep(40);
        holders--;
        await ctx.lockerA.release("Order", "o-reentrant");
      };
      await Promise.all([contend(), contend(), contend()]);
      expect(maxConcurrentHolders).toBe(1);
    });
  });
}
