import { describe, it, expect } from "vitest";
import { KeyedMutex } from "../keyed-mutex";

describe("KeyedMutex", () => {
  it("serializes concurrent lock() calls for the same key", async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];

    async function critical(n: number) {
      await mutex.lock("k");
      order.push(n);
      await new Promise((r) => setTimeout(r, 5));
      order.push(-n);
      mutex.unlock("k");
    }

    await Promise.all([critical(1), critical(2), critical(3)]);

    // Each critical section's enter/exit pair must be contiguous — no
    // interleaving between two different callers holding "k" at once.
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i + 1]).toBe(-order[i]!);
    }
  });

  it("does not block lock() calls for a different key", async () => {
    const mutex = new KeyedMutex();
    await mutex.lock("a");
    let bLocked = false;
    await mutex.lock("b").then(() => {
      bLocked = true;
    });
    expect(bLocked).toBe(true);
    mutex.unlock("a");
    mutex.unlock("b");
  });

  it("unlock on a key with no holder is a no-op", () => {
    const mutex = new KeyedMutex();
    expect(() => mutex.unlock("never-locked")).not.toThrow();
  });
});
