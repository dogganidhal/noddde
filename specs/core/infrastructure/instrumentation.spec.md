---
title: "Instrumentation"
module: infrastructure/instrumentation
source_file: packages/core/src/infrastructure/instrumentation.ts
status: implemented
exports: [Instrumentation, NoopInstrumentation]
depends_on: []
docs:
  - infrastructure/tracing.mdx
---

# Instrumentation

> `Instrumentation` is the transport-agnostic tracing abstraction that public config surfaces (messaging adapters) depend on, instead of importing a concrete engine class. `@noddde/core` has zero runtime dependencies, so this interface carries no OpenTelemetry types. `@noddde/engine` provides the concrete OTel-backed implementation (`OTelInstrumentation`). `NoopInstrumentation` is the zero-cost default when no tracing backend is configured.
>
> Moved to core from `@noddde/engine` as part of the 1.0 API freeze (decision 7, see `specs/api-freeze.spec.md`) — messaging adapters previously imported the concrete engine class and exposed it in their public config types, taking a full runtime dependency on `@noddde/engine` for a logger default and a tracing wrapper.

## Type Contract

```ts
interface Instrumentation {
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number | undefined>,
    fn: () => Promise<T>,
  ): Promise<T>;

  injectTraceContext(): { traceparent?: string; tracestate?: string };

  getActiveTraceCorrelation(): { traceId?: string; spanId?: string };

  withExtractedContext<T>(
    carrier: { traceparent?: string; tracestate?: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}

class NoopInstrumentation implements Instrumentation {
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number | undefined>,
    fn: () => Promise<T>,
  ): Promise<T>;
  injectTraceContext(): { traceparent?: string; tracestate?: string };
  getActiveTraceCorrelation(): { traceId?: string; spanId?: string };
  withExtractedContext<T>(
    carrier: { traceparent?: string; tracestate?: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}
```

- `Instrumentation` mirrors the method surface of `@noddde/engine`'s `OTelInstrumentation` (formerly the class named `Instrumentation`, renamed during the freeze to avoid colliding with this interface).
- `NoopInstrumentation` is a pure pass-through: `withSpan`/`withExtractedContext` just run `fn`, `injectTraceContext`/`getActiveTraceCorrelation` return `{}`.

## Behavioral Requirements

1. **withSpan runs fn and returns its result** -- Whether tracing is active or not, `withSpan(name, attributes, fn)` must run `fn` and resolve/reject with `fn`'s outcome.
2. **withSpan propagates thrown errors** -- If `fn` throws or rejects, `withSpan` must reject with the same error (implementations may additionally record it as an exception on an active span, but must not swallow it).
3. **injectTraceContext returns a possibly-empty object** -- `{}` when no span is active or tracing is not installed; otherwise `{ traceparent, tracestate? }`.
4. **getActiveTraceCorrelation returns absent (not null/empty-string) fields when inactive** -- `{}` when no span is active or tracing is not installed.
5. **withExtractedContext runs fn in the current context when the carrier has no traceparent** -- No-op passthrough in that case.
6. **NoopInstrumentation satisfies Instrumentation with zero tracing side effects** -- Every method is a pass-through; no span is ever created, no context is ever mutated.

## Invariants

- `Instrumentation` carries no OpenTelemetry (or any other tracing backend) types — `@noddde/core` has zero runtime dependencies.
- `NoopInstrumentation` never throws on its own — the only way a `withSpan`/`withExtractedContext` call rejects is if the caller's `fn` itself rejects.

## Edge Cases

- **withSpan with a synchronously throwing `fn`**: still surfaces as a rejected Promise, since `fn` is `() => Promise<T>` and implementations `await` it.
- **withExtractedContext with an empty carrier**: treated identically to "no traceparent" — runs `fn` in the current context.

## Integration Points

- `packages/engine/src/tracing.ts`'s `OTelInstrumentation` implements this interface with a real OpenTelemetry backend.
- `packages/engine/src/implementations/ee-event-bus.ts`'s `EventEmitterEventBusConfig.instrumentation` is typed against this interface, defaulting to `new NoopInstrumentation()`.
- Messaging adapters (`@noddde/kafka`, `@noddde/nats`, `@noddde/rabbitmq`) should type their `instrumentation?` config field against this interface instead of importing a concrete class from `@noddde/engine` (downstream work, not implemented by the API-freeze lane — see `specs/api-freeze.spec.md` decision 7).

## Test Scenarios

### Instrumentation is implemented by NoopInstrumentation

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Instrumentation } from "@noddde/core";
import { NoopInstrumentation } from "@noddde/core";

describe("Instrumentation", () => {
  it("should be implemented by NoopInstrumentation", () => {
    const instrumentation: Instrumentation = new NoopInstrumentation();
    expectTypeOf(instrumentation).toMatchTypeOf<Instrumentation>();
  });
});
```

### NoopInstrumentation: pass-through behavior

```ts
import { describe, it, expect } from "vitest";
import { NoopInstrumentation } from "@noddde/core";

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
```
