import { describe, it, expect } from "vitest";
import { InMemoryViewStore, InMemoryViewStoreFactory } from "@noddde/engine";

describe("InMemoryViewStoreFactory", () => {
  it("should return the same shared store regardless of ctx", () => {
    const factory = new InMemoryViewStoreFactory<{ id: string }>();
    const a = factory.getForContext();
    const b = factory.getForContext({ kind: "fake-tx" });
    const c = factory.getForContext(null);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("should reuse a caller-provided InMemoryViewStore instance", () => {
    const seeded = new InMemoryViewStore<{ id: string }>();
    const factory = new InMemoryViewStoreFactory(seeded);
    expect(factory.getForContext()).toBe(seeded);
  });

  it("should round-trip values through the shared store", async () => {
    const factory = new InMemoryViewStoreFactory<{
      id: string;
      total: number;
    }>();
    const store = factory.getForContext();
    await store.save("v-1", { id: "v-1", total: 42 });
    expect(await factory.getForContext().load("v-1")).toEqual({
      id: "v-1",
      total: 42,
    });
  });
});
