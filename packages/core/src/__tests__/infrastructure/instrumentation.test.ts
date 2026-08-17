import { describe, it, expect, expectTypeOf } from "vitest";
import type { Instrumentation } from "@noddde/core";
import { NoopInstrumentation } from "@noddde/core";

describe("Instrumentation", () => {
  it("should be implemented by NoopInstrumentation", () => {
    const instrumentation: Instrumentation = new NoopInstrumentation();
    expectTypeOf(instrumentation).toMatchTypeOf<Instrumentation>();
  });
});

describe("NoopInstrumentation", () => {
  it("withSpan should run fn and return its result without tracing", async () => {
    const instrumentation = new NoopInstrumentation();
    const result = await instrumentation.withSpan("op", {}, async () => 42);
    expect(result).toBe(42);
  });

  it("withSpan should propagate a thrown error from fn", async () => {
    const instrumentation = new NoopInstrumentation();
    await expect(
      instrumentation.withSpan("op", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("injectTraceContext should return an empty object", () => {
    const instrumentation = new NoopInstrumentation();
    expect(instrumentation.injectTraceContext()).toEqual({});
  });

  it("getActiveTraceCorrelation should return an empty object", () => {
    const instrumentation = new NoopInstrumentation();
    expect(instrumentation.getActiveTraceCorrelation()).toEqual({});
  });

  it("withExtractedContext should run fn in the current context as-is", async () => {
    const instrumentation = new NoopInstrumentation();
    const result = await instrumentation.withExtractedContext(
      {},
      async () => "ok",
    );
    expect(result).toBe("ok");
  });
});
