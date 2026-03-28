import { describe, it, expectTypeOf } from "vitest";
import type { Logger, LogLevel } from "@noddde/core";

describe("LogLevel", () => {
  it("should accept 'debug'", () => {
    expectTypeOf<"debug">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'info'", () => {
    expectTypeOf<"info">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'warn'", () => {
    expectTypeOf<"warn">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'error'", () => {
    expectTypeOf<"error">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'silent'", () => {
    expectTypeOf<"silent">().toMatchTypeOf<LogLevel>();
  });

  it("should not accept arbitrary strings", () => {
    expectTypeOf<"verbose">().not.toMatchTypeOf<LogLevel>();
  });
});

describe("Logger", () => {
  it("should have debug method with correct signature", () => {
    expectTypeOf<Logger["debug"]>().toBeFunction();
    expectTypeOf<Logger["debug"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["debug"]>().returns.toEqualTypeOf<void>();
  });

  it("should have info method with correct signature", () => {
    expectTypeOf<Logger["info"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["info"]>().returns.toEqualTypeOf<void>();
  });

  it("should have warn method with correct signature", () => {
    expectTypeOf<Logger["warn"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["warn"]>().returns.toEqualTypeOf<void>();
  });

  it("should have error method with correct signature", () => {
    expectTypeOf<Logger["error"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["error"]>().returns.toEqualTypeOf<void>();
  });
});

describe("Logger.child", () => {
  it("should accept a string namespace and return Logger", () => {
    expectTypeOf<Logger["child"]>().parameters.toEqualTypeOf<
      [namespace: string]
    >();
    expectTypeOf<Logger["child"]>().returns.toEqualTypeOf<Logger>();
  });

  it("should allow chained child calls", () => {
    type ChildReturn = ReturnType<ReturnType<Logger["child"]>["child"]>;
    expectTypeOf<ChildReturn>().toEqualTypeOf<Logger>();
  });
});

describe("Logger structural typing", () => {
  it("should accept any object with matching methods", () => {
    // eslint-disable-next-line no-unused-vars
    const customLogger: Logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child(): Logger {
        return this;
      },
    };
    expectTypeOf(customLogger).toMatchTypeOf<Logger>();
  });
});
