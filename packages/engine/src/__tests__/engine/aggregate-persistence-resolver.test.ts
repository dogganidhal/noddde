/* eslint-disable no-unused-vars */
import { describe, it, expect } from "vitest";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/engine";
import {
  GlobalAggregatePersistenceResolver,
  PerAggregatePersistenceResolver,
} from "../../aggregate-persistence-resolver";

// ============================================================
// GlobalAggregatePersistenceResolver returns the same persistence for any aggregate
// ============================================================

describe("GlobalAggregatePersistenceResolver", () => {
  it("should return the same persistence instance for any aggregate name", () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const resolver = new GlobalAggregatePersistenceResolver(persistence);

    expect(resolver.resolve("Foo")).toBe(persistence);
    expect(resolver.resolve("Bar")).toBe(persistence);
    expect(resolver.resolve("Foo")).toBe(resolver.resolve("Bar"));
  });
});

// ============================================================
// PerAggregatePersistenceResolver returns the correct persistence per aggregate
// ============================================================

describe("PerAggregatePersistenceResolver", () => {
  it("should return the correct persistence for each aggregate name", () => {
    const esPersistence = new InMemoryEventSourcedAggregatePersistence();
    const ssPersistence = new InMemoryStateStoredAggregatePersistence();
    const map = new Map([
      ["Counter", esPersistence as any],
      ["BankAccount", ssPersistence as any],
    ]);
    const resolver = new PerAggregatePersistenceResolver(map);

    expect(resolver.resolve("Counter")).toBe(esPersistence);
    expect(resolver.resolve("BankAccount")).toBe(ssPersistence);
  });

  it("should throw for unknown aggregate names", () => {
    const map = new Map([
      ["Counter", new InMemoryEventSourcedAggregatePersistence() as any],
    ]);
    const resolver = new PerAggregatePersistenceResolver(map);

    expect(() => resolver.resolve("NonExistent")).toThrow(
      /No persistence configured for aggregate "NonExistent"/,
    );
  });
});
