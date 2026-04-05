import { describe, it, expect, expectTypeOf } from "vitest";
import type { Closeable, BackgroundProcess } from "@noddde/core";
import { isCloseable } from "@noddde/core";

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
