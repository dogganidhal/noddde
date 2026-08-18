/* eslint-disable no-unused-vars */
import { describe, it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { DrizzleEventSourcedAggregatePersistence } from "../persistence";
import type { DrizzleTransactionStore } from "../index";

/** Captures the row values passed to `.insert(table).values(rows)`. */
function createCapturingDb() {
  let captured: any[] = [];
  return {
    insert(_table: any) {
      return {
        values(rows: any[]) {
          captured = rows;
          return Promise.resolve();
        },
      };
    },
    get captured() {
      return captured;
    },
  };
}

describe("nativeJson (issue #130 finding 2 — double JSON encoding)", () => {
  const txStore: DrizzleTransactionStore = { als: new AsyncLocalStorage() };
  const schema = { events: {} } as any;

  it("passes the raw payload object when nativeJson is true (pg/mysql jsonb/json columns)", async () => {
    const db = createCapturingDb();
    const persistence = new DrizzleEventSourcedAggregatePersistence(
      db,
      txStore,
      schema,
      true,
    );

    await persistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: { total: 100 } }],
      0,
    );

    expect(db.captured[0].payload).toEqual({ total: 100 });
    expect(typeof db.captured[0].payload).not.toBe("string");
  });

  it("JSON.stringify's the payload when nativeJson is false (sqlite text columns)", async () => {
    const db = createCapturingDb();
    const persistence = new DrizzleEventSourcedAggregatePersistence(
      db,
      txStore,
      schema,
      false,
    );

    await persistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: { total: 100 } }],
      0,
    );

    expect(db.captured[0].payload).toBe(JSON.stringify({ total: 100 }));
  });
});
