import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should store and retrieve a view", async () => {
    const store = new InMemoryViewStore<{ id: string; balance: number }>();

    await store.save("acc-1", { id: "acc-1", balance: 100 });

    const loaded = await store.load("acc-1");

    expect(loaded).toEqual({ id: "acc-1", balance: 100 });
  });

  it("should return undefined when no view exists", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    const loaded = await store.load("nonexistent");

    expect(loaded).toBeUndefined();
  });

  it("should overwrite view on subsequent saves", async () => {
    const store = new InMemoryViewStore<{ balance: number }>();

    await store.save("acc-1", { balance: 100 });
    await store.save("acc-1", { balance: 250 });

    const loaded = await store.load("acc-1");

    expect(loaded).toEqual({ balance: 250 });
  });

  it("should store separate views per ID", async () => {
    const store = new InMemoryViewStore<{ balance: number }>();

    await store.save("acc-1", { balance: 100 });
    await store.save("acc-2", { balance: 200 });

    const view1 = await store.load("acc-1");
    const view2 = await store.load("acc-2");

    expect(view1).toEqual({ balance: 100 });
    expect(view2).toEqual({ balance: 200 });
  });

  it("should return all views from findAll", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    await store.save("1", { id: "1" });
    await store.save("2", { id: "2" });
    await store.save("3", { id: "3" });

    const all = await store.findAll();

    expect(all).toHaveLength(3);
    expect(all).toEqual(
      expect.arrayContaining([{ id: "1" }, { id: "2" }, { id: "3" }]),
    );
  });

  it("should return empty array when no views exist", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    const all = await store.findAll();

    expect(all).toEqual([]);
  });

  it("should filter views using predicate", async () => {
    const store = new InMemoryViewStore<{ id: string; balance: number }>();

    await store.save("1", { id: "1", balance: 50 });
    await store.save("2", { id: "2", balance: 150 });
    await store.save("3", { id: "3", balance: 250 });

    const highBalance = await store.find((v) => v.balance >= 100);

    expect(highBalance).toHaveLength(2);
    expect(highBalance).toEqual(
      expect.arrayContaining([
        { id: "2", balance: 150 },
        { id: "3", balance: 250 },
      ]),
    );
  });

  it("should coerce numeric viewId to string key", async () => {
    const store = new InMemoryViewStore<{ value: number }>();

    await store.save(42, { value: 1 });

    const loaded = await store.load("42");

    expect(loaded).toEqual({ value: 1 });
  });

  it("should reflect the latest state after rapid save/load cycles", async () => {
    const store = new InMemoryViewStore<{ count: number }>();

    for (let i = 0; i < 10; i++) {
      await store.save("counter", { count: i });
    }

    const loaded = await store.load("counter");

    expect(loaded).toEqual({ count: 9 });
  });
});

describe("InMemoryViewStore delete", () => {
  it("should remove a previously stored view", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    await store.save("acc-1", { id: "acc-1" });
    expect(await store.load("acc-1")).toEqual({ id: "acc-1" });

    await store.delete("acc-1");

    expect(await store.load("acc-1")).toBeUndefined();
  });
});

describe("InMemoryViewStore delete idempotency", () => {
  it("should not throw when deleting a non-existent key", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    await expect(store.delete("nope")).resolves.toBeUndefined();
    await expect(store.delete("nope")).resolves.toBeUndefined();
  });
});

describe("InMemoryViewStore delete coercion", () => {
  it("should coerce numeric viewId to the same key as a string viewId", async () => {
    const store = new InMemoryViewStore<{ value: number }>();

    await store.save("42", { value: 1 });
    await store.delete(42);

    expect(await store.load("42")).toBeUndefined();
    expect(await store.load(42)).toBeUndefined();
  });
});

describe("InMemoryViewStore delete isolation", () => {
  it("should only remove the targeted view", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    await store.save("a", { id: "a" });
    await store.save("b", { id: "b" });
    await store.save("c", { id: "c" });

    await store.delete("b");

    expect(await store.load("a")).toEqual({ id: "a" });
    expect(await store.load("b")).toBeUndefined();
    expect(await store.load("c")).toEqual({ id: "c" });
    expect(
      (await store.findAll()).sort((x, y) => x.id.localeCompare(y.id)),
    ).toEqual([{ id: "a" }, { id: "c" }]);
  });
});

describe("InMemoryViewStore save after delete", () => {
  it("should store a new view after the previous one was deleted", async () => {
    const store = new InMemoryViewStore<{ value: number }>();

    await store.save("k", { value: 1 });
    await store.delete("k");
    await store.save("k", { value: 2 });

    expect(await store.load("k")).toEqual({ value: 2 });
  });
});
