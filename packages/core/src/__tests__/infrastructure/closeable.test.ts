import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Closeable,
  BackgroundProcess,
  Connectable,
  BrokerResilience,
} from "@noddde/core";
import { isCloseable, isConnectable } from "@noddde/core";

describe("isCloseable", () => {
  it("should return true for objects with a close function", () => {
    const closeable = { close: async () => {} };
    expect(isCloseable(closeable)).toBe(true);
  });

  it("should return false for null and undefined", () => {
    expect(isCloseable(null)).toBe(false);
    expect(isCloseable(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isCloseable(42)).toBe(false);
    expect(isCloseable("string")).toBe(false);
    expect(isCloseable(true)).toBe(false);
  });

  it("should return false for objects without a close property", () => {
    expect(isCloseable({})).toBe(false);
    expect(isCloseable({ foo: 1 })).toBe(false);
  });

  it("should return false when close is not a function", () => {
    expect(isCloseable({ close: "not a function" })).toBe(false);
    expect(isCloseable({ close: 42 })).toBe(false);
    expect(isCloseable({ close: null })).toBe(false);
  });

  it("should detect class instances that implement Closeable", () => {
    class DatabasePool implements Closeable {
      async close(): Promise<void> {}
    }

    expect(isCloseable(new DatabasePool())).toBe(true);
  });
});

describe("Closeable & BackgroundProcess Interfaces", () => {
  it("should have close returning Promise<void>", () => {
    expectTypeOf<Closeable["close"]>().toBeFunction();
    expectTypeOf<Closeable["close"]>().returns.toMatchTypeOf<Promise<void>>();
  });

  it("should have drain returning Promise<void>", () => {
    expectTypeOf<BackgroundProcess["drain"]>().toBeFunction();
    expectTypeOf<BackgroundProcess["drain"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});

describe("isConnectable", () => {
  it("should return true for objects with a connect function", () => {
    const connectable = { connect: async () => {} };
    expect(isConnectable(connectable)).toBe(true);
  });

  it("should return false for null and undefined", () => {
    expect(isConnectable(null)).toBe(false);
    expect(isConnectable(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isConnectable(42)).toBe(false);
    expect(isConnectable("string")).toBe(false);
    expect(isConnectable(true)).toBe(false);
  });

  it("should return false for objects without a connect property", () => {
    expect(isConnectable({})).toBe(false);
    expect(isConnectable({ foo: 1 })).toBe(false);
  });

  it("should return false when connect is not a function", () => {
    expect(isConnectable({ connect: "not a function" })).toBe(false);
    expect(isConnectable({ connect: 42 })).toBe(false);
    expect(isConnectable({ connect: null })).toBe(false);
  });

  it("should detect class instances that implement Connectable", () => {
    class KafkaBus implements Connectable {
      async connect(): Promise<void> {}
    }

    expect(isConnectable(new KafkaBus())).toBe(true);
  });
});

describe("Connectable Interface", () => {
  it("should have connect returning Promise<void>", () => {
    expectTypeOf<Connectable["connect"]>().toBeFunction();
    expectTypeOf<Connectable["connect"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});

describe("BrokerResilience", () => {
  it("should have all optional fields with correct types", () => {
    expectTypeOf<BrokerResilience>().toHaveProperty("maxAttempts");
    expectTypeOf<BrokerResilience>().toHaveProperty("initialDelayMs");
    expectTypeOf<BrokerResilience>().toHaveProperty("maxDelayMs");
    expectTypeOf<BrokerResilience>().toHaveProperty("maxRetries");

    // All fields are optional
    const empty: BrokerResilience = {};
    expectTypeOf(empty).toMatchTypeOf<BrokerResilience>();

    // All fields accept numbers
    const full: BrokerResilience = {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      maxRetries: 3,
    };
    expectTypeOf(full).toMatchTypeOf<BrokerResilience>();
  });
});
