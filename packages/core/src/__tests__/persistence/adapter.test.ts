import { describe, it, expect, expectTypeOf } from "vitest";
import type { PersistenceAdapter, EventReader } from "@noddde/core";
import { isPersistenceAdapter } from "@noddde/core";

describe("isPersistenceAdapter", () => {
  it("should return true for a minimal adapter with unitOfWorkFactory", () => {
    const adapter = {
      unitOfWorkFactory: () => ({
        enlist: () => {},
        commit: async () => {},
        rollback: async () => {},
      }),
    };

    expect(isPersistenceAdapter(adapter)).toBe(true);
  });

  it("should return true for a full adapter with all optional stores", () => {
    const adapter = {
      unitOfWorkFactory: () => ({
        enlist: () => {},
        commit: async () => {},
        rollback: async () => {},
      }),
      eventSourcedPersistence: {},
      stateStoredPersistence: {},
      sagaPersistence: {},
      snapshotStore: {},
      outboxStore: {},
      idempotencyStore: {},
      aggregateLocker: {},
      init: async () => {},
      close: async () => {},
    };

    expect(isPersistenceAdapter(adapter)).toBe(true);
  });

  it("should return false for null", () => {
    expect(isPersistenceAdapter(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isPersistenceAdapter(undefined)).toBe(false);
  });

  it("should return false for an empty object", () => {
    expect(isPersistenceAdapter({})).toBe(false);
  });

  it("should return false for a string", () => {
    expect(isPersistenceAdapter("string")).toBe(false);
  });

  it("should return false for a number", () => {
    expect(isPersistenceAdapter(42)).toBe(false);
  });

  it("should return false when unitOfWorkFactory is not a function", () => {
    expect(isPersistenceAdapter({ unitOfWorkFactory: "not-a-function" })).toBe(
      false,
    );
    expect(isPersistenceAdapter({ unitOfWorkFactory: 42 })).toBe(false);
    expect(isPersistenceAdapter({ unitOfWorkFactory: null })).toBe(false);
    expect(isPersistenceAdapter({ unitOfWorkFactory: {} })).toBe(false);
  });
});

describe("PersistenceAdapter.eventReader", () => {
  it("should accept an EventReader on the adapter", () => {
    const reader: EventReader = {
      read: () => (async function* () {})(),
    };
    const adapter: PersistenceAdapter = {
      unitOfWorkFactory: { create: async () => null as any },
      eventReader: reader,
    };
    expectTypeOf(adapter.eventReader).toEqualTypeOf<EventReader | undefined>();
  });

  it("should be optional", () => {
    const adapter: PersistenceAdapter = {
      unitOfWorkFactory: { create: async () => null as any },
    };
    expectTypeOf(adapter.eventReader).toEqualTypeOf<EventReader | undefined>();
    expect(adapter.eventReader).toBeUndefined();
  });
});
