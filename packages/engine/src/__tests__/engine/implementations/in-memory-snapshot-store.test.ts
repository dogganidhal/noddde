import { describe, it, expect } from "vitest";
import { InMemorySnapshotStore } from "@noddde/engine";

describe("InMemorySnapshotStore", () => {
  it("should store and retrieve a snapshot", async () => {
    const store = new InMemorySnapshotStore();
    const snapshot = { state: { balance: 250, owner: "Alice" }, version: 5 };

    await store.save("BankAccount", "acc-1", snapshot);
    const loaded = await store.load("BankAccount", "acc-1");

    expect(loaded).toEqual(snapshot);
  });

  it("should return null when no snapshot exists", async () => {
    const store = new InMemorySnapshotStore();
    const loaded = await store.load("BankAccount", "nonexistent");

    expect(loaded).toBeNull();
  });

  it("should overwrite the snapshot on subsequent saves", async () => {
    const store = new InMemorySnapshotStore();

    await store.save("BankAccount", "acc-1", {
      state: { balance: 100 },
      version: 3,
    });
    await store.save("BankAccount", "acc-1", {
      state: { balance: 200 },
      version: 7,
    });

    const loaded = await store.load("BankAccount", "acc-1");
    expect(loaded).toEqual({ state: { balance: 200 }, version: 7 });
  });

  it("should isolate snapshots between different aggregate names", async () => {
    const store = new InMemorySnapshotStore();

    await store.save("Order", "1", { state: { total: 50 }, version: 2 });
    await store.save("Account", "1", { state: { balance: 999 }, version: 5 });

    const orderSnapshot = await store.load("Order", "1");
    const accountSnapshot = await store.load("Account", "1");

    expect(orderSnapshot).toEqual({ state: { total: 50 }, version: 2 });
    expect(accountSnapshot).toEqual({ state: { balance: 999 }, version: 5 });
  });

  it("should isolate snapshots between different aggregate IDs", async () => {
    const store = new InMemorySnapshotStore();

    await store.save("BankAccount", "acc-1", {
      state: { balance: 100 },
      version: 3,
    });
    await store.save("BankAccount", "acc-2", {
      state: { balance: 500 },
      version: 8,
    });

    const acc1 = await store.load("BankAccount", "acc-1");
    const acc2 = await store.load("BankAccount", "acc-2");

    expect(acc1).toEqual({ state: { balance: 100 }, version: 3 });
    expect(acc2).toEqual({ state: { balance: 500 }, version: 8 });
  });
});
