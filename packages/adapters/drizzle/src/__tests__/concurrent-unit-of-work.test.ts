/* eslint-disable no-unused-vars */
import { describe, it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { DrizzleUnitOfWork } from "../unit-of-work";
import type { DrizzleTransactionStore } from "../index";

/**
 * A minimal fake "callback-dialect" db (mirrors the shape `commitWithCallback`
 * expects: `db.transaction(async (tx) => ...)`), where two `transaction()`
 * calls can be genuinely in flight at once — like a real pooled pg/mysql
 * driver — each handed a distinct `tx` marker. This reproduces the exact
 * concurrency shape issue #129 finding 1 describes without needing a real
 * database connection.
 */
function createFakePooledDb() {
  let txCounter = 0;
  return {
    async transaction(cb: (tx: unknown) => Promise<void>) {
      const tx = { id: ++txCounter };
      // Yield to the microtask queue before running the callback so two
      // concurrent `commit()` calls actually interleave instead of running
      // one fully to completion before the other starts.
      await Promise.resolve();
      await cb(tx);
    },
  };
}

describe("DrizzleUnitOfWork — concurrent commits (issue #129 finding 1)", () => {
  it("each UoW's enlisted operations observe only their own transaction", async () => {
    const db = createFakePooledDb();
    const txStore: DrizzleTransactionStore = { als: new AsyncLocalStorage() };

    const observedA: unknown[] = [];
    const observedB: unknown[] = [];

    const uowA = new DrizzleUnitOfWork(db, txStore);
    const uowB = new DrizzleUnitOfWork(db, txStore);

    uowA.enlist(async () => {
      observedA.push(txStore.als.getStore());
      await new Promise((r) => setTimeout(r, 5));
      observedA.push(txStore.als.getStore());
    });
    uowB.enlist(async () => {
      observedB.push(txStore.als.getStore());
      await new Promise((r) => setTimeout(r, 5));
      observedB.push(txStore.als.getStore());
    });

    await Promise.all([uowA.commit(), uowB.commit()]);

    expect(observedA).toHaveLength(2);
    expect(observedB).toHaveLength(2);
    // Every observation within a UoW's own ops must be the same tx object,
    // and it must differ from the other UoW's tx — no cross-contamination.
    expect(observedA[0]).toBe(observedA[1]);
    expect(observedB[0]).toBe(observedB[1]);
    expect(observedA[0]).not.toBe(observedB[0]);
    expect(txStore.als.getStore()).toBeUndefined();
  });
});
