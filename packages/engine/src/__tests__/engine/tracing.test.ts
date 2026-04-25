import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { defineAggregate, defineProjection, defineSaga } from "@noddde/core";
import type {
  AggregateTypes,
  ProjectionTypes,
  SagaTypes,
  DefineEvents,
  DefineCommands,
  DefineQueries,
  Infrastructure,
  CQRSInfrastructure,
} from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  InMemoryViewStoreFactory,
} from "@noddde/engine";
import { detectOTel, Instrumentation } from "../../tracing";
import { MetadataEnricher } from "../../executors/metadata-enricher";
import type { MetadataContext } from "../../domain";

// ─── Shared OTel test infrastructure ────────────────────────────────

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

// ─── detectOTel ─────────────────────────────────────────────────────

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

// ─── Instrumentation.withSpan ───────────────────────────────────────

describe("Instrumentation.withSpan", () => {
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

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

// ─── Instrumentation.withSpan error recording ───────────────────────

describe("Instrumentation.withSpan error recording", () => {
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

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

// ─── Instrumentation.injectTraceContext ──────────────────────────────

describe("Instrumentation.injectTraceContext", () => {
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

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

// ─── Instrumentation.withExtractedContext ────────────────────────────

describe("Instrumentation.withExtractedContext", () => {
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

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

// ─── Instrumentation no-op ──────────────────────────────────────────

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

// ─── MetadataEnricher with tracing ──────────────────────────────────

describe("MetadataEnricher with tracing", () => {
  let instrumentation: Instrumentation;

  beforeAll(async () => {
    const otel = await detectOTel();
    instrumentation = new Instrumentation(otel);
  });

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

// ─── Full pipeline: command → projection ────────────────────────────

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
    Incremented: (_payload, state) => ({ count: state.count + 1 }),
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
      reduce: (_event, view) => ({ count: view.count + 1 }),
    },
  },
});

describe("Full pipeline tracing: command → projection", () => {
  it("should create command dispatch span and projection handle span sharing the same traceId", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: {
        projections: { CounterView },
      },
    });

    const domain = await wireDomain(definition, {
      projections: {
        CounterView: { viewStore: new InMemoryViewStoreFactory() },
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

describe("Full pipeline tracing: UoW commit span", () => {
  it("should create a noddde.uow.commit span as child of command dispatch", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: {
        projections: { CounterView },
      },
    });

    const domain = await wireDomain(definition, {
      projections: {
        CounterView: { viewStore: new InMemoryViewStoreFactory() },
      },
    });

    await domain.dispatchCommand({
      name: "Increment",
      payload: { counterId: "c1" },
      targetAggregateId: "c1",
    });

    const spans = exporter.getFinishedSpans();

    const commandSpan = spans.find((s) => s.name === "noddde.command.dispatch");
    const uowSpan = spans.find((s) => s.name === "noddde.uow.commit");

    expect(commandSpan).toBeDefined();
    expect(uowSpan).toBeDefined();

    // UoW span shares the same traceId as the command span
    expect(uowSpan!.spanContext().traceId).toBe(
      commandSpan!.spanContext().traceId,
    );

    // UoW span has aggregate attributes
    expect(uowSpan!.attributes["noddde.aggregate.name"]).toBe("Counter");
    expect(uowSpan!.attributes["noddde.aggregate.id"]).toBe("c1");

    await domain.shutdown();
  });
});

// ─── Full pipeline: command → saga → downstream command ─────────────

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

    // UoW commit spans: one for the initial PlaceOrder command, one for the saga
    const uowSpans = spans.filter((s) => s.name === "noddde.uow.commit");
    expect(uowSpans.length).toBeGreaterThanOrEqual(2);

    // All UoW spans share the same traceId
    for (const uowSpan of uowSpans) {
      expect(uowSpan.spanContext().traceId).toBe(traceId);
    }

    // Saga UoW span has saga name attribute
    const sagaUowSpan = uowSpans.find(
      (s) => s.attributes["noddde.saga.name"] === "OrderSaga",
    );
    expect(sagaUowSpan).toBeDefined();

    await domain.shutdown();
  });
});
