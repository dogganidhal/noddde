---
title: "OTel Trace Context Propagation"
module: engine/tracing
source_file: packages/engine/src/tracing.ts
status: implemented
exports: []
depends_on:
  - edd/event-metadata
  - engine/executors/metadata-enricher
  - engine/executors/command-lifecycle-executor
  - engine/executors/saga-executor
  - engine/domain
docs:
  - running/observability.mdx
---

# OTel Trace Context Propagation

> Native OpenTelemetry instrumentation for the noddde engine. Automatically detects `@opentelemetry/api` at runtime via dynamic `import()` — when present, creates spans at every pipeline stage and propagates W3C Trace Context through event metadata across write, read, and process models. When absent, all instrumentation is a zero-cost no-op. Users opt in simply by installing `@opentelemetry/api` and configuring an SDK/exporter of their choice (GCP, Datadog, Jaeger, etc.).

## Type Contract

```ts
// Internal to @noddde/engine — not part of the public API.

/**
 * Resolved OpenTelemetry API bindings, or null when @opentelemetry/api
 * is not installed in the host application.
 */
type OTelApi = {
  trace: typeof import("@opentelemetry/api").trace;
  context: typeof import("@opentelemetry/api").context;
  propagation: typeof import("@opentelemetry/api").propagation;
  SpanStatusCode: typeof import("@opentelemetry/api").SpanStatusCode;
};

/**
 * Attempts to dynamically import @opentelemetry/api at runtime.
 * Returns the API bindings if the package is installed, null otherwise.
 * Called once during Domain.init().
 */
function detectOTel(): Promise<OTelApi | null>;

/**
 * Thin, safe wrapper around OTel APIs. All methods are no-ops when
 * constructed with null (i.e. @opentelemetry/api is not installed).
 */
class Instrumentation {
  constructor(otel: OTelApi | null);

  /**
   * Runs `fn` inside a new child span of the active context.
   * On success, sets span status to OK. On error, records the exception
   * and sets span status to ERROR before re-throwing.
   */
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number | undefined>,
    fn: () => Promise<T>,
  ): Promise<T>;

  /**
   * Serializes the active trace context into W3C Trace Context format.
   * Returns { traceparent, tracestate } if a span is active, empty object otherwise.
   */
  injectTraceContext(): { traceparent?: string; tracestate?: string };

  /**
   * Extracts trace context from a carrier (typically event metadata) and
   * runs `fn` inside the restored context. If carrier has no traceparent,
   * runs fn in the current context as-is.
   */
  withExtractedContext<T>(
    carrier: { traceparent?: string; tracestate?: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}
```

- `@opentelemetry/api` is declared as an **optional peer dependency** in `@noddde/engine`'s `package.json`: `"peerDependencies": { "@opentelemetry/api": "^1.0.0" }` with `"peerDependenciesMeta": { "@opentelemetry/api": { "optional": true } }`.
- No other `@opentelemetry/*` packages are dependencies of the engine. Users bring their own SDK and exporter.

## Behavioral Requirements

### Runtime Detection

1. **Dynamic import** — `detectOTel()` uses `await import("@opentelemetry/api")` inside a try/catch. If the import succeeds, it returns the `{ trace, context, propagation, SpanStatusCode }` bindings. If it throws (module not found), it returns `null`.
2. **Single detection** — `detectOTel()` is called once during `Domain.init()`. The result is stored and reused for the domain's lifetime.
3. **Logging** — When OTel is detected, the domain logs an info message: `"OpenTelemetry detected. Tracing enabled."`. When not detected, a debug message: `"OpenTelemetry not detected. Tracing disabled."`.

### Span Creation

4. **`withSpan` creates a child span** — When OTel is active, `withSpan(name, attributes, fn)` creates a new span named `name` as a child of the current active context, sets the provided attributes, and runs `fn` inside the span's context. The span is ended after `fn` completes (success or error).
5. **`withSpan` records success** — On successful completion, the span's status is set to `SpanStatusCode.OK`.
6. **`withSpan` records errors** — If `fn` throws, the span records the exception via `span.recordException(error)`, sets status to `SpanStatusCode.ERROR`, and re-throws the error.
7. **`withSpan` no-op** — When OTel is null, `withSpan` calls `fn()` directly without creating a span.

### Trace Context Propagation

8. **`injectTraceContext` serializes active context** — When OTel is active and a span is in the active context, `injectTraceContext()` uses `propagation.inject()` to serialize W3C Trace Context into a carrier, returning `{ traceparent, tracestate }`.
9. **`injectTraceContext` returns empty when no span** — If no span is active (or OTel is null), returns `{}`.
10. **`withExtractedContext` restores context from carrier** — When OTel is active and `carrier.traceparent` is defined, `withExtractedContext` uses `propagation.extract()` to deserialize the trace context, then runs `fn` inside the restored context via `context.with()`.
11. **`withExtractedContext` passthrough when no traceparent** — If `carrier.traceparent` is undefined (or OTel is null), calls `fn()` in the current context.

### Pipeline Integration — Write Model

12. **Command dispatch span** — `Domain.dispatchCommand()` wraps the entire command execution in a span named `noddde.command.dispatch` with attributes: `noddde.command.name`, `noddde.aggregate.name` (if aggregate command), `noddde.aggregate.id` (if aggregate command).
13. **Trace context stamped on events** — `MetadataEnricher.enrich()` calls `instrumentation.injectTraceContext()` and merges the result (`traceparent`, `tracestate`) into each event's `EventMetadata`. All events in a batch share the same trace context.

### Pipeline Integration — Read Model

14. **Projection event handling span** — When the domain dispatches an event to a projection handler, the engine wraps the handler execution in `instrumentation.withExtractedContext(event.metadata, ...)` followed by `instrumentation.withSpan("noddde.projection.handle", { "noddde.projection.name", "noddde.event.name" }, ...)`.

### Pipeline Integration — Process Model

15. **Saga event handling span** — When the `SagaExecutor` processes an event, it wraps the full saga lifecycle (load → handle → persist → dispatch commands) in `instrumentation.withExtractedContext(event.metadata, ...)` followed by `instrumentation.withSpan("noddde.saga.handle", { "noddde.saga.name", "noddde.event.name" }, ...)`.
16. **Saga commands inherit trace** — Commands dispatched by the saga reaction execute inside the saga's restored trace context, so their spans are children of the saga span, which is itself linked to the original command's trace.

### Pipeline Integration — Unit of Work

17. **UoW commit span (command)** — When `CommandLifecycleExecutor` commits an implicit UoW, it wraps the `uow.commit()` call in a span named `noddde.uow.commit` with attributes: `noddde.aggregate.name`, `noddde.aggregate.id`. This separates business logic (decide) latency from database (commit) latency.
18. **UoW commit span (saga)** — When `SagaExecutor` commits the saga UoW, it wraps the `uow.commit()` call in a span named `noddde.uow.commit` with attribute `noddde.saga.name`.

### Pipeline Integration — Query Model

19. **Query dispatch span** — `Domain.dispatchQuery()` wraps the query execution in a span named `noddde.query.dispatch` with attribute `noddde.query.name`.

## Invariants

- `detectOTel()` never throws — it always returns `OTelApi | null`.
- `Instrumentation` methods never throw due to OTel issues — errors from span creation or propagation are swallowed (the domain operation must not fail because of tracing).
- When OTel is null, all methods are pure pass-through: `withSpan` calls `fn()`, `injectTraceContext` returns `{}`, `withExtractedContext` calls `fn()`.
- Trace context in event metadata (`traceparent`, `tracestate`) is always derived from the active OTel context at enrichment time, never manually constructed.
- The `Instrumentation` instance is shared across the entire domain (single tracer).

## Edge Cases

- **No OTel SDK registered (API installed but no provider)** — `trace.getTracer()` returns a no-op tracer. Spans are no-ops. `propagation.inject()` produces no headers. This is correct OTel behavior — the engine doesn't need to handle this specially.
- **OTel API installed but dynamic import fails for other reasons** — `detectOTel()` catches all errors and returns null.
- **Event with no metadata** — `withExtractedContext` receives `{ traceparent: undefined }`, falls through to passthrough path.
- **Span attribute values are undefined** — OTel API ignores undefined attribute values. No special handling needed.
- **Multiple events in a batch** — All share the same traceparent/tracestate (injected once per enrichment call, same as correlationId).

## Integration Points

- **EventMetadata** — The `traceparent` and `tracestate` fields on `EventMetadata` carry trace context through the event store, enabling cross-process trace propagation.
- **MetadataEnricher** — Modified to accept an optional `Instrumentation` and call `injectTraceContext()` during enrichment.
- **CommandLifecycleExecutor** — Modified to accept an optional `Instrumentation` and wrap implicit `uow.commit()` in a `noddde.uow.commit` span. Trace context flows implicitly via OTel's context propagation (the span started by `Domain.dispatchCommand` is the parent for all downstream operations).
- **SagaExecutor** — Modified to accept an optional `Instrumentation` for extracting context from events and wrapping saga lifecycle in spans.
- **Domain** — Calls `detectOTel()` during `init()`, constructs `Instrumentation`, passes to executors. Wraps `dispatchCommand` and `dispatchQuery` in spans.
- **Engine package.json** — Adds `@opentelemetry/api` as optional peer dependency.

## Test Scenarios

### detectOTel returns API bindings when @opentelemetry/api is available

```ts
import { describe, it, expect } from "vitest";
import { detectOTel } from "../tracing";

describe("detectOTel", () => {
  it("should return OTel API bindings when @opentelemetry/api is installed", async () => {
    const otel = await detectOTel();
    expect(otel).not.toBeNull();
    expect(otel!.trace).toBeDefined();
    expect(otel!.context).toBeDefined();
    expect(otel!.propagation).toBeDefined();
    expect(otel!.SpanStatusCode).toBeDefined();
  });
});
```

### Instrumentation.withSpan creates a span with name and attributes

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { detectOTel, Instrumentation } from "../tracing";

describe("Instrumentation.withSpan", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should create a span with the given name and attributes", async () => {
    await instrumentation.withSpan(
      "test.span",
      { "test.attr": "value", "test.num": 42 },
      async () => {},
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("test.span");
    expect(spans[0]!.attributes["test.attr"]).toBe("value");
    expect(spans[0]!.attributes["test.num"]).toBe(42);
  });
});
```

### Instrumentation.withSpan records error on exception

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { detectOTel, Instrumentation } from "../tracing";

describe("Instrumentation.withSpan error recording", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should record exception and set ERROR status when fn throws", async () => {
    await expect(
      instrumentation.withSpan("error.span", {}, async () => {
        throw new Error("test error");
      }),
    ).rejects.toThrow("test error");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]!.events).toHaveLength(1);
    expect(spans[0]!.events[0]!.name).toBe("exception");
  });
});
```

### Instrumentation.injectTraceContext returns traceparent within active span

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { detectOTel, Instrumentation } from "../tracing";

describe("Instrumentation.injectTraceContext", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should return a valid W3C traceparent string within an active span", async () => {
    let traceCtx: { traceparent?: string; tracestate?: string } = {};

    await instrumentation.withSpan("inject.test", {}, async () => {
      traceCtx = instrumentation.injectTraceContext();
    });

    expect(traceCtx.traceparent).toBeDefined();
    expect(traceCtx.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
  });
});
```

### Instrumentation.withExtractedContext restores trace context and creates child span

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { detectOTel, Instrumentation } from "../tracing";

describe("Instrumentation.withExtractedContext", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should restore trace context from traceparent and link child span to same trace", async () => {
    let traceparent: string | undefined;

    // Create a parent span and capture its traceparent
    await instrumentation.withSpan("parent", {}, async () => {
      traceparent = instrumentation.injectTraceContext().traceparent;
    });

    const parentSpan = exporter.getFinishedSpans()[0]!;
    exporter.reset();

    // In a separate context, extract and create a child
    await instrumentation.withExtractedContext({ traceparent }, async () => {
      await instrumentation.withSpan("child", {}, async () => {});
    });

    const childSpan = exporter.getFinishedSpans()[0]!;
    // Child span should share the same traceId as the parent
    expect(childSpan.spanContext().traceId).toBe(
      parentSpan.spanContext().traceId,
    );
  });
});
```

### Instrumentation is a no-op when constructed with null

```ts
import { describe, it, expect } from "vitest";
import { Instrumentation } from "../tracing";

describe("Instrumentation no-op", () => {
  it("should pass through withSpan without creating spans", async () => {
    const instrumentation = new Instrumentation(null);

    let called = false;
    await instrumentation.withSpan("noop", {}, async () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("should return empty object from injectTraceContext", () => {
    const instrumentation = new Instrumentation(null);
    const ctx = instrumentation.injectTraceContext();
    expect(ctx).toEqual({});
  });

  it("should pass through withExtractedContext", async () => {
    const instrumentation = new Instrumentation(null);

    let called = false;
    await instrumentation.withExtractedContext(
      {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      },
      async () => {
        called = true;
      },
    );
    expect(called).toBe(true);
  });
});
```

### MetadataEnricher stamps traceparent on events when instrumentation is active

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { detectOTel, Instrumentation } from "../tracing";
import { MetadataEnricher } from "../executors/metadata-enricher";
import type { MetadataContext } from "../domain";

describe("MetadataEnricher with tracing", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should add traceparent to event metadata when enriching within an active span", async () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage, undefined, instrumentation);

    let enriched: any[] = [];
    await instrumentation.withSpan("noddde.command.dispatch", {}, async () => {
      enriched = enricher.enrich(
        [{ name: "Created", payload: { id: "1" } }],
        "Thing",
        "1",
        0,
        "CreateThing",
      );
    });

    expect(enriched[0]!.metadata.traceparent).toBeDefined();
    expect(enriched[0]!.metadata.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
  });
});
```

### Full pipeline: command dispatch creates span and trace context propagates to projection

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { defineAggregate, defineProjection } from "@noddde/core";
import type {
  AggregateTypes,
  ProjectionTypes,
  DefineEvents,
  DefineCommands,
  DefineQueries,
  Infrastructure,
} from "@noddde/core";
import { defineDomain, wireDomain, InMemoryViewStore } from "@noddde/engine";

type CounterEvents = DefineEvents<{
  Incremented: { counterId: string };
}>;

type CounterCommands = DefineCommands<{
  Increment: { counterId: string };
}>;

type CounterTypes = AggregateTypes & {
  state: { count: number };
  events: CounterEvents;
  commands: CounterCommands;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  decide: {
    Increment: (command) => ({
      name: "Incremented" as const,
      payload: { counterId: command.payload.counterId },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + 1 }),
  },
});

type CounterViewQueries = DefineQueries<{
  GetCounter: { counterId: string; result: { count: number } };
}>;

type CounterViewTypes = ProjectionTypes & {
  view: { count: number };
  events: CounterEvents;
  queries: CounterViewQueries;
  infrastructure: Infrastructure;
};

const CounterView = defineProjection<CounterViewTypes>({
  initialView: { count: 0 },
  on: {
    Incremented: {
      id: (event) => event.payload.counterId,
      reduce: (event, view) => ({ count: view.count + 1 }),
    },
  },
});

describe("Full pipeline tracing: command → projection", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should create command dispatch span and projection handle span sharing the same traceId", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: {
        projections: { CounterView },
      },
    });

    const domain = await wireDomain(definition, {
      projections: {
        CounterView: { viewStore: () => new InMemoryViewStore() },
      },
    });

    await domain.dispatchCommand({
      name: "Increment",
      payload: { counterId: "c1" },
      targetAggregateId: "c1",
    });

    const spans = exporter.getFinishedSpans();

    const commandSpan = spans.find((s) => s.name === "noddde.command.dispatch");
    const projectionSpan = spans.find(
      (s) => s.name === "noddde.projection.handle",
    );

    expect(commandSpan).toBeDefined();
    expect(projectionSpan).toBeDefined();

    // Both spans should share the same traceId
    expect(projectionSpan!.spanContext().traceId).toBe(
      commandSpan!.spanContext().traceId,
    );

    // Command span attributes
    expect(commandSpan!.attributes["noddde.command.name"]).toBe("Increment");

    // Projection span attributes
    expect(projectionSpan!.attributes["noddde.projection.name"]).toBe(
      "CounterView",
    );
    expect(projectionSpan!.attributes["noddde.event.name"]).toBe("Incremented");

    await domain.shutdown();
  });
});
```

### Full pipeline: saga restores trace context and propagates to downstream command

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { defineAggregate, defineSaga } from "@noddde/core";
import type {
  AggregateTypes,
  SagaTypes,
  DefineEvents,
  DefineCommands,
  Infrastructure,
  CQRSInfrastructure,
} from "@noddde/core";
import { defineDomain, wireDomain } from "@noddde/engine";

type OrderEvents = DefineEvents<{
  OrderPlaced: { orderId: string };
}>;

type OrderCommands = DefineCommands<{
  PlaceOrder: { orderId: string };
}>;

type OrderTypes = AggregateTypes & {
  state: { placed: boolean };
  events: OrderEvents;
  commands: OrderCommands;
  infrastructure: Infrastructure;
};

const Order = defineAggregate<OrderTypes>({
  initialState: { placed: false },
  decide: {
    PlaceOrder: (command) => ({
      name: "OrderPlaced" as const,
      payload: { orderId: command.payload.orderId },
    }),
  },
  evolve: {
    OrderPlaced: () => ({ placed: true }),
  },
});

type PaymentEvents = DefineEvents<{
  PaymentRequested: { orderId: string };
}>;

type PaymentCommands = DefineCommands<{
  RequestPayment: { orderId: string };
}>;

type PaymentTypes = AggregateTypes & {
  state: { requested: boolean };
  events: PaymentEvents;
  commands: PaymentCommands;
  infrastructure: Infrastructure;
};

const Payment = defineAggregate<PaymentTypes>({
  initialState: { requested: false },
  decide: {
    RequestPayment: (command) => ({
      name: "PaymentRequested" as const,
      payload: { orderId: command.payload.orderId },
    }),
  },
  evolve: {
    PaymentRequested: () => ({ requested: true }),
  },
});

type OrderSagaState = { status: string };
type OrderSagaTypes = SagaTypes & {
  state: OrderSagaState;
  events: OrderEvents;
  commands: PaymentCommands;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const OrderSaga = defineSaga<OrderSagaTypes>({
  initialState: { status: "new" },
  startedBy: ["OrderPlaced"],
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event) => ({
        state: { status: "payment_requested" },
        commands: {
          name: "RequestPayment",
          payload: { orderId: event.payload.orderId },
          targetAggregateId: event.payload.orderId,
        },
      }),
    },
  },
});

describe("Full pipeline tracing: command → saga → downstream command", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(() => exporter.reset());
  afterAll(() => provider.shutdown());

  it("should trace from command through saga to downstream command with same traceId", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Order, Payment } },
      readModel: { projections: {} },
      processModel: { sagas: { OrderSaga } },
    });

    const domain = await wireDomain(definition, {});

    await domain.dispatchCommand({
      name: "PlaceOrder",
      payload: { orderId: "o1" },
      targetAggregateId: "o1",
    });

    const spans = exporter.getFinishedSpans();

    const placeOrderSpan = spans.find(
      (s) =>
        s.name === "noddde.command.dispatch" &&
        s.attributes["noddde.command.name"] === "PlaceOrder",
    );
    const sagaSpan = spans.find((s) => s.name === "noddde.saga.handle");
    const requestPaymentSpan = spans.find(
      (s) =>
        s.name === "noddde.command.dispatch" &&
        s.attributes["noddde.command.name"] === "RequestPayment",
    );

    expect(placeOrderSpan).toBeDefined();
    expect(sagaSpan).toBeDefined();
    expect(requestPaymentSpan).toBeDefined();

    // All three spans share the same traceId
    const traceId = placeOrderSpan!.spanContext().traceId;
    expect(sagaSpan!.spanContext().traceId).toBe(traceId);
    expect(requestPaymentSpan!.spanContext().traceId).toBe(traceId);

    // Saga span attributes
    expect(sagaSpan!.attributes["noddde.saga.name"]).toBe("OrderSaga");
    expect(sagaSpan!.attributes["noddde.event.name"]).toBe("OrderPlaced");

    await domain.shutdown();
  });
});
```
