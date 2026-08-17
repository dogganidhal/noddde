---
title: "NatsEventBus"
module: adapters/nats/nats-event-bus
source_file: packages/adapters/nats/src/nats-event-bus.ts
status: implemented
exports: [NatsEventBus, NatsEventBusConfig]
depends_on:
  - core/edd/event-bus
  - core/edd/event
  - core/infrastructure/closeable
  - core/infrastructure/connectable
  - core/infrastructure/broker-resilience
  - core/infrastructure/logger
docs:
  - docs/content/docs/running/event-bus-adapters.mdx
---

# NatsEventBus

> NATS-backed EventBus implementation using the `nats` client library with JetStream for durable subscriptions. Publishes domain events to NATS subjects and delivers them to registered handlers via JetStream consumers. Provides at-least-once delivery with durable subscriptions. Suitable for distributed deployments where lightweight, high-throughput event streaming is required.

## Type Contract

```ts
import type {
  EventBus,
  AsyncEventHandler,
  Connectable,
  BrokerResilience,
  Logger,
} from "@noddde/core";

/** Configuration for the NatsEventBus. */
export interface NatsEventBusConfig {
  /** NATS server URL(s) (e.g., "localhost:4222" or ["nats://host1:4222", "nats://host2:4222"]). */
  servers: string | string[];
  /**
   * Consumer group identity. Used both as the prefix for JetStream durable consumer names
   * and as the JetStream deliver/queue group. Two services with different consumerGroup
   * values independently consume the same stream without stealing each other's messages.
   * Multiple bus instances (replicas) sharing the same consumerGroup for the same event
   * bind to the same durable as competing consumers (queue group semantics) — the stream's
   * messages are split across them, not duplicated. Analogous to Kafka's groupId.
   */
  consumerGroup: string;
  /** JetStream stream name for durable subscriptions (e.g., "noddde-events"). */
  streamName?: string;
  /**
   * Prefix prepended to event names to form subject names (e.g., "noddde." → "noddde.AccountCreated").
   * Optional for dispatch/subscribe subject naming (defaults to no prefix). **Required** when
   * `streamName` is also configured — without a prefix, the stream would be created with the
   * subject `">"`, claiming every subject on the server. A prefix without a trailing `.` (e.g.
   * `"myapp"`) is normalized to end with `.` before being used to compute stream subjects.
   */
  subjectPrefix?: string;
  /** Maximum number of unacknowledged messages per consumer (default: 256). Provides backpressure control. */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=-1/infinite, initialDelayMs=2000). NATS uses fixed intervals — maxDelayMs is ignored. */
  resilience?: BrokerResilience;
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:nats") from @noddde/engine. */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
   * Provided via `@noddde/engine` `Instrumentation`.
   */
  instrumentation?: Instrumentation;
}

export class NatsEventBus implements EventBus, Connectable {
  constructor(config: NatsEventBusConfig);

  /** Establishes a connection to the NATS server and initializes JetStream. Must be called before dispatch or on. */
  connect(): Promise<void>;

  /** Registers a handler for a given event name. Creates a JetStream consumer subscription for the subject. */
  on(eventName: string, handler: AsyncEventHandler): void;

  /** Publishes an event to the NATS subject derived from the event name. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;

  /** Drains the NATS connection, clears handlers. Idempotent. */
  close(): Promise<void>;
}
```

## Behavioral Requirements

### Dispatch

1. **Subject derivation** -- `dispatch(event)` publishes to a NATS subject named `${subjectPrefix}${event.name}` (default prefix is empty, so subject = event name).
2. **JSON serialization** -- The full event object (`{ name, payload, metadata? }`) is serialized as JSON in the message data.
3. **JetStream publish** -- `dispatch` uses JetStream `publish()` for durable message delivery. Awaits the publish acknowledgment.
4. **Dispatch before connect throws** -- Calling `dispatch` before `connect()` throws an error.

### Subscription / Handler Registration

5. **on registers handlers by event name** -- `on(eventName, handler)` stores the handler in an internal registry keyed by event name. Multiple handlers per event name are supported (fan-out within the same process).

   5b. **Already-subscribed guard** -- The bus tracks which event names it has already created a JetStream subscription for, in an internal `Set`. When `on()` is called for an event name that already has an active subscription (whether created during `_activateSubscriptions()` at `connect()` time, or via an earlier late `on()` call), the new handler is added to the handler registry but **no new `js.subscribe()` call is made**. The handler still receives deliveries because `_handleMessage` fans out to every handler registered for the event name from the single existing subscription. Only a genuinely new event name (not yet subscribed) triggers a new subscription attempt.

6. **JetStream consumer with group-scoped durable name and queue group** -- When subscriptions are activated (after `connect()`), a JetStream consumer is created for each registered event name's subject. The durable consumer name is `${consumerGroup}_${sanitized(eventName)}` where `sanitized` replaces non-alphanumeric characters (except `_` and `-`) with underscores. The same durable name is also set as the JetStream **deliver group** (`opts.deliverGroup(durableName)`) — the queue-group equivalent for JetStream push consumers. This ensures two services with different `consumerGroup` values get independent durable consumers on the same stream — they do not share cursor positions or steal each other's messages — **and** that multiple bus instances (replicas) sharing the same `consumerGroup` bind to the _same_ durable as competing consumers: the server splits deliveries across them instead of rejecting the second binder or duplicating messages.

   6b. **Per-subscription inbox subject** -- Each push consumer created by `_createSubscriptionForEvent` declares its own unique `deliverTo(createInbox())` subject (required by NATS Server ≥2.10 for push consumers, and necessary so two parallel subscribers in the same process don't collide). This is a deliberate design choice, not an oversight: benchmarked at 1000 subscriptions on a single bus (see the "inbox subject benchmark" describe block in `packages/adapters/nats/src/__tests__/integration/nats.integration.test.ts`), the per-subscription memory cost is dominated by the JetStream consumer/subscription object itself (tens of KB), not the inbox subject string (tens of bytes) — sharing inboxes across subscriptions would not meaningfully change memory footprint. Inboxes are intentionally never shared across subscriptions, even within the same `consumerGroup`. With `deliverGroup` set, each _replica process_ still uses its own private inbox — the deliver group, not the inbox, is what makes them compete for the same messages.

7. **Message deserialization with poison message protection** -- Incoming NATS messages are deserialized from JSON in `_consumeSubscription`. Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message), the error is logged and `msg.term()` is called to permanently discard it. The `msg.term()` call is itself wrapped in try/catch — if the connection dropped between receipt and term, the error is logged but the consumer loop continues to the next message.
8. **Isolated parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.allSettled()` (not `Promise.all()`). This guarantees that **every registered handler runs to completion** even when some of them fail — siblings are never silenced or short-circuited by an earlier rejection. After all handlers settle, the bus iterates the rejected results and logs each one individually via the framework `Logger` at `error` level with structured fields (see "Per-handler error logging" below). If at least one handler rejected, `_handleMessage` then propagates a failure (re-throwing the first rejection's reason) so the outer consumer loop calls `msg.nak()` for immediate redelivery per current behavior (capped by `maxDeliver`). The `msg.nak()` call is itself wrapped in try/catch — if the connection dropped, the error is logged but the consumer loop continues. Handlers that already completed will re-execute on redelivery — consumers must be idempotent.

   8c. **Per-handler error logging** -- For each rejected handler, the bus calls `logger.error(message, fields)` exactly once with:

   - `eventName: string` — from `event.name`.
   - `eventId?: string` — from `event.metadata?.eventId` when present.
   - `handlerName: string` — read from the handler's `name` property; falls back to `event.name` when anonymous.
   - `error: { name, message, stack? }` — extracted from the caught exception. Non-`Error` rejection values are coerced via `String(value)` into `message`.
   - `traceId?: string` and `spanId?: string` — populated from the active OpenTelemetry span via the configured `Instrumentation` instance. Absent when no span is active or when `@opentelemetry/api` is not installed.

9. **Ack after handlers** -- The message is acknowledged (`msg.ack()`) only after all handlers have completed successfully. The `msg.ack()` call is wrapped in try/catch for the same connection-drop resilience as nak/term.

### Backpressure

10. **prefetchCount configuration** -- When creating JetStream consumer subscriptions, set `maxAckPending` on the consumer options to the value of `prefetchCount`. Default: 256. This limits the number of unacknowledged messages the server delivers to the consumer, providing natural backpressure when handlers are slow.
    10b. **maxRetries delivery limit** -- If `resilience.maxRetries` is configured, set `maxDeliver` on the JetStream consumer options. This limits how many times NATS will redeliver a message before discarding it, preventing handler-level poison messages from blocking the subscription indefinitely.

    10c. **Nak backoff on handler failure** -- When a handler fails and the message is naked, `_consumeSubscription` computes a backoff delay from the message's delivery count (`msg.info.deliveryCount`, defaulting to `1` when unavailable, e.g. in unit tests with hand-built message mocks): `delayMs = min(500 * 2^(deliveryCount - 1), 30_000)`. The delay is passed to `msg.nak(delayMs)` instead of naking immediately, preventing a poison message from hot-looping redelivery.

    10d. **Dead-letter parking on exhausted retries** -- If `resilience.maxRetries` is configured and the failed delivery is the last allowed attempt (`msg.info.deliveryCount >= resilience.maxRetries`), the bus does not rely on the server's silent `maxDeliver` discard. Instead, before naking/terming, it publishes the original raw message bytes to a dead-letter subject `${subjectPrefix ?? ""}dlq.${eventName}` via `this._js.publish()`, with headers carrying failure metadata (`noddde-original-subject`, `noddde-delivery-count`, `noddde-failure-reason`). After the publish (best-effort — a DLQ publish failure is logged, not thrown), the message is terminated (`msg.term()`) rather than naked, since it has already exhausted its retries. If `resilience.maxRetries` is not configured, no DLQ publish occurs (no defined retry ceiling); the nak-backoff behavior in 10c still applies to prevent a hot loop.

### Connection Lifecycle

11. **connect establishes NATS connection** -- `connect()` connects to the NATS server and obtains a JetStream context. Creates or verifies the stream if `streamName` is configured. The `resilience` config option is mapped to NATS client reconnection options: `maxAttempts` → `maxReconnectAttempts`, `initialDelayMs` → `reconnectTimeWait`. Reconnection is enabled by default. `maxDelayMs` is ignored for connection reconnection (NATS uses fixed intervals there); it is unrelated to the nak-backoff cap in 10c, which is a fixed internal constant. Defaults: reconnect=true, maxReconnectAttempts=-1 (infinite), reconnectTimeWait=2000ms.

    11b. **subjectPrefix required when streamName is configured** -- When `streamName` is set and the stream does not yet exist, `connect()` computes the stream's subjects from `subjectPrefix`. If `subjectPrefix` is not set, `connect()` throws a clear error before creating the stream — an unset prefix would otherwise create a stream claiming `">"`; (every subject on the server). When `subjectPrefix` is set, it is normalized to end with `.` if it doesn't already (so `"myapp"` and `"myapp."` both compute the same subject `"myapp.>"`) before appending `>`. The computed subject is validated: if it is exactly `">"` or contains a stray wildcard character (`*` or `>`) outside the trailing `>`, `connect()` throws instead of creating an overly broad or malformed stream.

12. **connect is idempotent** -- Calling `connect()` when already connected is a no-op.
13. **close drains the connection** -- `close()` drains the NATS connection (processes in-flight messages, then disconnects), clears the handler registry.
14. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

15. **Handler errors prevent ack** -- After `Promise.allSettled` settles every registered handler and each rejection has been logged individually, `_handleMessage` re-throws the first rejected handler's reason. The outer consumer loop catches this and calls `msg.nak()` for redelivery (capped by `maxDeliver`). The message is not acknowledged. All sibling handlers ran to completion before this re-throw — none are silenced by an earlier rejection.
    15b. **Consumer loop error propagation** -- The consumer loop promise (`_consumeSubscription`) must NOT be fire-and-forget (`void`). It must have a `.catch()` handler that logs the error. If the async iterator throws (e.g., connection drop), the error is caught and logged instead of becoming an unhandled promise rejection.
16. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
17. **Connection errors on dispatch** -- If the NATS server is unreachable, `dispatch` rejects with a connection error.

### Fail-Fast Connect

18. **connect rejects on subscription failure** -- During `connect()`, if any call to `_createSubscriptionForEvent()` in `_activateSubscriptions()` throws, `connect()` must reject with the error. The caller must know the bus is not fully operational. Subscription failures via late `on()` calls (after `connect()` has already resolved) are logged via the logger but do not crash the process.

### Ordering Guarantees

20. **Same-event-name ordering only** -- NATS JetStream ordering is scoped to a single durable consumer for a single subject (one event name). Within that scope, messages are delivered in the order they were stored in the stream, subject to redelivery: a naked or reconnect-triggered redelivery can reorder relative to messages acked after it. Ordering is **not** guaranteed across different event names, even for the same aggregate — each event name has its own durable consumer, subject, and cursor, with no coordination between them. A handler (e.g. a projection) that consumes multiple event types for one aggregate must be order-tolerant and idempotent — guard state transitions with `event.metadata.sequenceNumber` (or equivalent) rather than assuming arrival order matches emission order. This is a routing-topology limitation, not a bug: fixing it would require routing by aggregate type/id instead of by event name, which needs an `EventBus` surface `@noddde/core` does not currently expose.

### Logging

21. **Framework logger** -- All internal logging uses the `Logger` interface from `@noddde/core`. The logger is resolved from `config.logger` or defaults to `new NodddeLogger("warn", "noddde:nats")` from `@noddde/engine`. All log calls pass structured context data as the second parameter (e.g., `{ eventName }`, `{ error: String(err) }`). No `console.log`, `console.warn`, or `console.error` calls exist in the implementation.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Messages are acknowledged only after every handler for the message has settled and none rejected.
- All registered handlers for an event delivery run to completion, even when some fail (per-handler isolation via `Promise.allSettled`).
- Each handler failure produces exactly one `logger.error` call with structured fields.
- The bus does not deduplicate events.
- Subject names follow the pattern `${subjectPrefix}${eventName}`.
- JetStream durable consumer names follow the pattern `${consumerGroup}_${sanitized(eventName)}`.
- Two bus instances with different `consumerGroup` values on the same stream maintain independent consumer cursors.
- Multiple bus instances (replicas) sharing the same `consumerGroup` for the same event name are competing consumers (JetStream deliver group) — they split the stream's messages, they never both boot-fail and never both receive every message.
- A second `on()` call for an event name that already has an active subscription never issues a second `js.subscribe()` call.
- JetStream provides durable message storage — events survive broker restarts.
- No `console.*` calls exist in the implementation — all logging goes through the `Logger` interface.
- A stream is never created with the subject `">"`. `subjectPrefix` is required whenever `streamName` is configured.
- Ordering is guaranteed only within a single durable consumer for one event name — never across different event names.
- An exhausted-retry message (delivery count reaches `resilience.maxRetries`) is published to a dead-letter subject with failure metadata before being termed, never silently discarded.
- A nak triggered by handler failure always carries a backoff delay computed from the delivery count — never an immediate zero-delay nak.

## Edge Cases

- **No handler registered for consumed subject**: Message is acknowledged with no processing.
- **Handler throws**: Message is not acknowledged; NATS redelivers based on consumer config.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers invoked in parallel via `Promise.allSettled()`. Every handler runs to completion. Each rejection is logged individually. If at least one rejected, the message is not acknowledged (NATS redelivers per `maxDeliver`). Handlers that already completed will re-execute on redelivery.
- **Two handlers, one throws**: Both handlers run; one error log is emitted with the failed handler's name; `msg.nak()` is called → NATS redelivers.
- **on() called before connect()**: Handlers are buffered; subscriptions happen when `connect()` is called.
- **on() called after close()**: Throws an error.
- **Stream does not exist**: `connect()` creates the stream if `streamName` is configured and stream does not exist.
- **Two services with different consumerGroup on same stream**: Each gets its own durable consumer — independent cursor positions, no message stealing.
- **Subscription creation fails during connect**: `connect()` rejects with the error. The bus is not marked as connected.
- **Subscription creation fails during late on()**: Error is logged via `this._logger.error()`. The handler is still registered (retry on next connection cycle).
- **No logger provided**: Defaults to `NodddeLogger("warn", "noddde:nats")` — behaves like the previous `console.error`/`console.warn` output but with structured formatting.
- **Two replicas, same consumerGroup, same event name**: Both `connect()` successfully (no "duplicate subscription" error) because the shared durable name is also set as the JetStream deliver group. Messages for that event name are split across the two replicas (competing consumers), not duplicated to both.
- **Second `on()` for an already-subscribed event name after connect()**: The new handler is registered and will be invoked on delivery (via the existing subscription's fan-out in `_handleMessage`), but no second `js.subscribe()` call is made.
- **`streamName` configured, `subjectPrefix` not set**: `connect()` throws before creating the stream, rather than creating a `">"` stream that claims every subject.
- **`subjectPrefix` without a trailing dot (e.g. `"myapp"`)**: Normalized to `"myapp."` before computing the stream subject, producing the valid `"myapp.>"` rather than the invalid `"myapp>"`.
- **Handler fails and `resilience.maxRetries` is reached on this delivery**: The raw message is published to the dead-letter subject with failure metadata, then `msg.term()` is called — the message is not silently discarded by the server and not further redelivered.
- **Handler fails and `resilience.maxRetries` is not yet reached (or not configured)**: `msg.nak(delayMs)` is called with a backoff delay derived from the delivery count, instead of an immediate zero-delay nak.

## Integration Points

- Provided via `DomainWiring.buses()` factory. `Domain.init()` auto-calls `connect()` via `Connectable` auto-discovery (no manual connect needed).
- `Domain.init()` calls `bus.on(eventName, handler)` to register projection, saga, and standalone event handlers (after auto-connect).
- `Domain.shutdown()` calls `bus.close()` (via `Closeable` auto-discovery) to drain and disconnect.

## Test Scenarios

### dispatch publishes event to correct subject

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should publish event to subject derived from event name", async () => {
    const mockJetstream = {
      publish: vi.fn().mockResolvedValue({ seq: 1, stream: "test" }),
    };
    const mockConnection = {
      jetstream: () => mockJetstream,
      jetstreamManager: vi
        .fn()
        .mockResolvedValue({ streams: { info: vi.fn() } }),
      drain: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = mockConnection;
    (bus as any)._js = mockJetstream;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockJetstream.publish).toHaveBeenCalledWith(
      "AccountCreated",
      expect.any(Uint8Array),
    );
  });
});
```

### dispatch uses subject prefix when configured

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should prepend subjectPrefix to event name for subject", async () => {
    const mockJetstream = {
      publish: vi.fn().mockResolvedValue({ seq: 1, stream: "test" }),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      subjectPrefix: "noddde.",
    });
    (bus as any)._nc = {};
    (bus as any)._js = mockJetstream;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    expect(mockJetstream.publish).toHaveBeenCalledWith(
      "noddde.OrderPlaced",
      expect.any(Uint8Array),
    );
  });
});
```

### dispatch throws before connect

```ts
import { describe, it, expect } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should throw when dispatching before connect", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });
});
```

### on registers handler and receives events

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    bus.on("AccountCreated", handler);

    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage("AccountCreated", JSON.stringify(event));

    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

### multiple handlers for same event are invoked in parallel

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push("slow");
    });
    bus.on("TestEvent", async () => {
      results.push("fast");
    });

    const event = { name: "TestEvent", payload: {} };
    await (bus as any)._handleMessage("TestEvent", JSON.stringify(event));

    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("fast");
  });
});
```

### parallel handler failure prevents ack while siblings still complete

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should reject _handleMessage after all handlers settled, with siblings completed", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    const successHandler = vi.fn();
    bus.on("TestEvent", successHandler);
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage("TestEvent", JSON.stringify(event)),
    ).rejects.toThrow("handler failed");

    // The successful sibling completed even though another handler threw.
    expect(successHandler).toHaveBeenCalledOnce();
  });
});
```

### sibling handler completes when an earlier handler throws (Promise.allSettled)

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus error isolation", () => {
  it("should run every handler to completion even when an earlier one throws", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    const before = vi.fn();
    const after = vi.fn();
    bus.on("E", before);
    bus.on("E", async () => {
      throw new Error("boom");
    });
    bus.on("E", after);

    await expect(
      (bus as any)._handleMessage(
        "E",
        JSON.stringify({ name: "E", payload: {} }),
      ),
    ).rejects.toThrow();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});
```

### individual logging per failed handler with handlerName and error fields

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";
import type { Logger } from "@noddde/core";

describe("NatsEventBus error isolation", () => {
  it("should log once per failed handler with handlerName and error fields", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      logger,
    });

    async function failingA() {
      throw new Error("err-a");
    }
    async function failingB() {
      throw new Error("err-b");
    }
    bus.on("E", vi.fn());
    bus.on("E", failingA);
    bus.on("E", failingB);

    await expect(
      (bus as any)._handleMessage(
        "E",
        JSON.stringify({ name: "E", payload: {} }),
      ),
    ).rejects.toThrow();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const handlerErrorCalls = errorCalls.filter(
      ([, fields]) => (fields as any)?.handlerName !== undefined,
    );
    expect(handlerErrorCalls).toHaveLength(2);
    const names = handlerErrorCalls.map(([, f]) => (f as any).handlerName);
    expect(names).toEqual(expect.arrayContaining(["failingA", "failingB"]));
    const messages = handlerErrorCalls.map(
      ([, f]) => (f as any).error?.message,
    );
    expect(messages).toEqual(expect.arrayContaining(["err-a", "err-b"]));
  });
});
```

### nak behavior is unchanged under partial failure

````ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus error isolation", () => {
  it("should call msg.nak() when any handler fails (existing redelivery behavior is preserved)", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    bus.on("E", vi.fn());
    bus.on("E", async () => {
      throw new Error("boom");
    });

    const event = { name: "E", payload: {} };
    const nak = vi.fn();
    const ack = vi.fn();
    const term = vi.fn();
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      nak,
      ack,
      term,
    };

    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "E");

    // Regression guard: nak is called on handler failure, ack is not.
    expect(nak).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  });
});

### JetStream consumer sets deliverGroup equal to the durable name

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus queue group", () => {
  it("should set deliverGroup to the durable name so replicas compete for messages", async () => {
    const mockOpts = {
      durable: vi.fn(),
      deliverGroup: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
      deliverTo: vi.fn(),
    };
    const mockSub = (async function* () {})();
    const mockJs = { subscribe: vi.fn().mockResolvedValue(mockSub) };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "order-service",
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    bus.on("AccountCreated", vi.fn());
    await new Promise((r) => setTimeout(r, 10));

    expect(mockOpts.deliverGroup).toHaveBeenCalledWith(
      "order-service_AccountCreated",
    );

    vi.restoreAllMocks();
  });
});
````

### already-subscribed guard prevents a second js.subscribe for the same event name

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus already-subscribed guard", () => {
  it("should not resubscribe when a second handler is registered for an already-subscribed event", async () => {
    const mockOpts = {
      durable: vi.fn(),
      deliverGroup: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
      deliverTo: vi.fn(),
    };
    const mockSub = (async function* () {})();
    const mockJs = { subscribe: vi.fn().mockResolvedValue(mockSub) };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    const first = vi.fn();
    const second = vi.fn();
    bus.on("AccountCreated", first);
    await new Promise((r) => setTimeout(r, 10));
    bus.on("AccountCreated", second);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockJs.subscribe).toHaveBeenCalledOnce();

    const event = { name: "AccountCreated", payload: {} };
    await (bus as any)._handleMessage("AccountCreated", JSON.stringify(event));
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);

    vi.restoreAllMocks();
  });
});
```

### stream creation throws when subjectPrefix is not set

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus subject prefix safety", () => {
  it("should throw at connect() when streamName is set without subjectPrefix", async () => {
    const natsModule = await import("nats");
    vi.spyOn(natsModule, "connect").mockResolvedValue({
      jetstream: () => ({}),
      jetstreamManager: vi.fn().mockResolvedValue({
        streams: { info: vi.fn().mockRejectedValue(new Error("not found")) },
      }),
      drain: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    } as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      streamName: "noddde-events",
    });

    await expect(bus.connect()).rejects.toThrow(/subjectPrefix/i);

    vi.restoreAllMocks();
  });
});
```

### subjectPrefix with and without a trailing dot normalize to the same stream subject

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus subject prefix safety", () => {
  it("should normalize a prefix without a trailing dot to match one with a trailing dot", async () => {
    const bus1 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "g1",
      streamName: "s1",
      subjectPrefix: "myapp",
    });
    const bus2 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "g2",
      streamName: "s2",
      subjectPrefix: "myapp.",
    });

    expect((bus1 as any)._buildSubjectsForStream()).toEqual(["myapp.>"]);
    expect((bus2 as any)._buildSubjectsForStream()).toEqual(["myapp.>"]);
  });
});
```

### exhausted-retry message is published to the dead-letter subject before being termed

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus dead-letter handling", () => {
  it("should publish to the DLQ subject and term when delivery count reaches maxRetries", async () => {
    const publish = vi.fn().mockResolvedValue({ seq: 1, stream: "test" });
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      resilience: { maxRetries: 2 },
    });
    (bus as any)._js = { publish };
    bus.on("TestEvent", async () => {
      throw new Error("boom");
    });

    const event = { name: "TestEvent", payload: {} };
    const term = vi.fn();
    const nak = vi.fn();
    const ack = vi.fn();
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      info: { deliveryCount: 2 },
      term,
      nak,
      ack,
    };
    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    expect(publish).toHaveBeenCalledWith(
      "dlq.TestEvent",
      expect.anything(),
      expect.objectContaining({ headers: expect.anything() }),
    );
    expect(term).toHaveBeenCalledOnce();
    expect(nak).not.toHaveBeenCalled();
  });
});
```

### nak backoff increases with delivery count and stays below maxRetries

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus dead-letter handling", () => {
  it("should nak with an increasing delay derived from delivery count", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      resilience: { maxRetries: 5 },
    });
    bus.on("TestEvent", async () => {
      throw new Error("boom");
    });

    const event = { name: "TestEvent", payload: {} };
    const nak = vi.fn();
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      info: { deliveryCount: 2 },
      term: vi.fn(),
      nak,
      ack: vi.fn(),
    };
    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    expect(nak).toHaveBeenCalledOnce();
    const delayArg = nak.mock.calls[0]![0];
    expect(delayArg).toBeGreaterThan(0);
  });
});
```

````

### connect maps resilience config to nats reconnection options

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should map BrokerResilience to nats reconnection options", () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      resilience: {
        maxAttempts: 10,
        initialDelayMs: 5000,
      },
    });

    // Config is stored for mapping during connect()
    expect((bus as any)._config.resilience).toEqual({
      maxAttempts: 10,
      initialDelayMs: 5000,
    });
  });
});
````

### prefetchCount is set on consumer subscriptions

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should configure prefetchCount as maxAckPending on JetStream consumer options", () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      prefetchCount: 100,
    });

    expect((bus as any)._config.prefetchCount).toBe(100);
  });
});
```

### close drains connection and clears handlers

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should drain connection and clear handlers on close", async () => {
    const mockDrain = vi.fn().mockResolvedValue(undefined);
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = {
      drain: mockDrain,
      isClosed: vi.fn().mockReturnValue(false),
    };
    (bus as any)._connected = true;

    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockDrain).toHaveBeenCalled();

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });
});
```

### close is idempotent

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should not throw when close is called multiple times", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = {
      drain: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    };
    (bus as any)._connected = true;

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });
});
```

### dispatch serializes full event as JSON

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should serialize the full event object including metadata", async () => {
    const mockPublish = vi.fn().mockResolvedValue({ seq: 1, stream: "test" });

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = {};
    (bus as any)._js = { publish: mockPublish };
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: { eventId: "evt-1", correlationId: "corr-1" },
    };
    await bus.dispatch(event);

    const sentData = mockPublish.mock.calls[0]![1];
    const decoded = new TextDecoder().decode(sentData);
    const parsed = JSON.parse(decoded);
    expect(parsed).toEqual(event);
  });
});
```

### consumerGroup scopes durable consumer names

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should use consumerGroup as prefix in durable consumer name", async () => {
    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "order-service",
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    bus.on("AccountCreated", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    expect(mockOpts.durable).toHaveBeenCalledWith(
      "order-service_AccountCreated",
    );

    vi.restoreAllMocks();
  });
});
```

### different consumerGroup values produce independent durable names

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should produce different durable names for different consumerGroup values on the same event", async () => {
    const durableNames: string[] = [];
    const mockOpts = {
      durable: vi.fn((name: string) => durableNames.push(name)),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus1 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "billing-service",
    });
    (bus1 as any)._js = mockJs;
    (bus1 as any)._connected = true;
    bus1.on("OrderPlaced", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    const bus2 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "shipping-service",
    });
    (bus2 as any)._js = mockJs;
    (bus2 as any)._connected = true;
    bus2.on("OrderPlaced", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    expect(durableNames).toContain("billing-service_OrderPlaced");
    expect(durableNames).toContain("shipping-service_OrderPlaced");
    expect(durableNames[0]).not.toBe(durableNames[1]);

    vi.restoreAllMocks();
  });
});
```

### connect rejects when subscription creation fails

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should reject connect() when subscription creation fails during _activateSubscriptions", async () => {
    const natsModule = await import("nats");

    vi.spyOn(natsModule, "connect").mockResolvedValue({
      jetstream: () => ({
        subscribe: vi.fn().mockRejectedValue(new Error("subscription failed")),
      }),
      jetstreamManager: vi.fn().mockResolvedValue({
        streams: { info: vi.fn() },
      }),
      drain: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    } as any);

    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-service",
    });

    // Register a handler before connect so _activateSubscriptions runs
    bus.on("TestEvent", vi.fn());

    await expect(bus.connect()).rejects.toThrow("subscription failed");

    vi.restoreAllMocks();
  });
});
```

### logger receives structured calls instead of console

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";
import type { Logger } from "@noddde/core";

describe("NatsEventBus", () => {
  it("should use provided logger for error and warn logging with structured data", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-service",
      logger: mockLogger,
    });

    const handler = vi.fn().mockRejectedValue(new Error("handler boom"));
    bus.on("TestEvent", handler);

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      nak: vi.fn(),
      ack: vi.fn(),
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    // Logger should have been called with structured data, not console
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Handler error"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });
});
```
