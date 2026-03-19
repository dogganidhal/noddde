import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker } from "@noddde/engine";
import { LockTimeoutError } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("acquire and release on a single key works without blocking", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Account", "acc-1");
    await locker.release("Account", "acc-1");

    // Should be able to acquire again immediately
    await locker.acquire("Account", "acc-1");
    await locker.release("Account", "acc-1");
  });

  it("second acquire on same key blocks until first release", async () => {
    const locker = new InMemoryAggregateLocker();
    const timeline: string[] = [];

    await locker.acquire("Account", "acc-1");
    timeline.push("first-acquired");

    const secondAcquire = locker.acquire("Account", "acc-1").then(() => {
      timeline.push("second-acquired");
    });

    // Allow microtasks to settle — second acquire should still be waiting
    await new Promise((r) => setTimeout(r, 10));
    expect(timeline).toEqual(["first-acquired"]);

    // Release first lock — second should now proceed
    await locker.release("Account", "acc-1");
    await secondAcquire;

    expect(timeline).toEqual(["first-acquired", "second-acquired"]);

    // Clean up
    await locker.release("Account", "acc-1");
  });

  it("timeout throws LockTimeoutError", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Account", "acc-1");

    await expect(locker.acquire("Account", "acc-1", 50)).rejects.toThrow(
      LockTimeoutError,
    );

    // Clean up
    await locker.release("Account", "acc-1");
  });

  it("release is idempotent (double release does not throw)", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Account", "acc-1");
    await locker.release("Account", "acc-1");

    // Second release should not throw
    await locker.release("Account", "acc-1");
  });

  it("different keys do not interfere", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Account", "acc-1");
    // Acquiring a different key should not block
    await locker.acquire("Account", "acc-2");

    await locker.release("Account", "acc-1");
    await locker.release("Account", "acc-2");
  });

  it("FIFO ordering (first waiter gets lock first)", async () => {
    const locker = new InMemoryAggregateLocker();
    const order: number[] = [];

    await locker.acquire("Account", "acc-1");

    // Queue up three waiters
    const w1 = locker.acquire("Account", "acc-1").then(() => {
      order.push(1);
    });
    const w2 = locker.acquire("Account", "acc-1").then(() => {
      order.push(2);
    });
    const w3 = locker.acquire("Account", "acc-1").then(() => {
      order.push(3);
    });

    // Release the initial lock, then release each subsequent one
    await locker.release("Account", "acc-1");
    await w1;

    await locker.release("Account", "acc-1");
    await w2;

    await locker.release("Account", "acc-1");
    await w3;

    // Clean up the last lock
    await locker.release("Account", "acc-1");

    expect(order).toEqual([1, 2, 3]);
  });
});
