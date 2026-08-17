---
title: "OutboxRelay"
module: engine/outbox-relay
source_file: packages/engine/src/outbox-relay.ts
status: implemented
exports:
  - OutboxRelay
  - OutboxRelayOptions
depends_on:
  - persistence/outbox
  - edd/event-bus
  - infrastructure/closeable
docs: [running/outbox-pattern.mdx]
---

# OutboxRelay

> Background process that polls the `OutboxStore` for unpublished entries and dispatches them via the `EventBus`. Provides at-least-once delivery guarantees for domain events. Designed for crash recovery: if the node crashes after database commit but before event publishing, the relay picks up unpublished entries on restart.

## Type Contract

```ts
import type { OutboxStore, EventBus, BackgroundProcess } from "@noddde/core";

/**
 * Configuration options for the OutboxRelay.
 */
interface OutboxRelayOptions {
  /** Polling interval in milliseconds. Defaults to 1000. */
  pollIntervalMs?: number;
  /** Maximum entries to process per batch. Defaults to 100. */
  batchSize?: number;
}

/**
 * Background process that polls the OutboxStore for unpublished entries
 * and dispatches them via the EventBus. Provides at-least-once delivery.
 *
 * @internal Created and managed by the Domain. Not exported to consumers directly.
 */
class OutboxRelay implements BackgroundProcess {
  constructor(
    outboxStore: OutboxStore,
    eventBus: EventBus,
    options?: OutboxRelayOptions,
  );

  /** Start polling for unpublished entries. Idempotent: calling start() when already running is a no-op. */
  start(): void;

  /** Stop polling. Idempotent: calling stop() when not running is a no-op. */
  stop(): void;

  /**
   * Stops polling and processes remaining unpublished entries until
   * the outbox is empty. Implements BackgroundProcess.drain.
   * Idempotent: subsequent calls resolve immediately.
   */
  drain(): Promise<void>;

  /**
   * Process one batch of unpublished entries synchronously (no timer).
   * Loads entries, dispatches each via EventBus, marks each published.
   * Returns the number of entries successfully dispatched.
   * Exposed for testing via Domain.processOutboxOnce().
   */
  processOnce(): Promise<number>;
}
```

- `OutboxRelay` is engine-internal but exported from `@noddde/engine` for testing.
- `processOnce()` processes entries one-by-one: dispatch, then mark published, for each entry. This minimizes the re-delivery window on crash.
- The relay serializes `processOnce()` calls via an internal `processing` flag to prevent concurrent batch processing.

## Behavioral Requirements

1. **processOnce loads and dispatches unpublished entries** -- Calls `outboxStore.loadUnpublished(batchSize)` to get a batch. For each entry, dispatches `entry.event` via `eventBus.dispatch(event)`, then calls `outboxStore.markPublished([entry.id])`. Returns the count of successfully dispatched entries.
2. **processOnce handles dispatch errors gracefully** -- If `eventBus.dispatch()` throws for an entry, that entry is NOT marked as published. Processing continues with the next entry. The error is not propagated (the failed entry will be retried on the next poll).
3. **start begins polling** -- Creates a `setInterval` that calls `processOnce()` at every `pollIntervalMs` (default 1000ms). Idempotent: if already started, calling `start()` again is a no-op.
4. **stop clears the polling timer** -- Clears the interval created by `start()`. Idempotent: if not running, calling `stop()` is a no-op.
5. **concurrent processOnce calls are serialized** -- If `processOnce()` is already running (e.g., a poll fires while a previous batch is still processing), the new call returns immediately with 0.
6. **processOnce returns 0 for empty batches** -- If `loadUnpublished` returns an empty array, returns 0 without further work.
7. **drain stops polling and processes until empty** -- `drain()` calls `stop()` to clear the polling timer, then loops `processOnce()` until it returns 0. Implements `BackgroundProcess.drain`. Idempotent: subsequent calls resolve immediately.

## Invariants

- Events are dispatched in `createdAt` order (the order returned by `loadUnpublished`).
- Each entry is marked published individually, immediately after successful dispatch.
- A dispatch failure for one entry does not prevent processing of subsequent entries in the batch.
- The relay never creates, modifies, or deletes outbox entries except via `markPublished`.
- The timer is always cleaned up by `stop()`. No timer leaks.
- A handler failure is invisible to the relay by design: the relay only observes whether `eventBus.dispatch()` rejects, not what registered handlers did. Bus implementations that isolate handler errors (e.g. `EventEmitterEventBus`, whose per-handler isolation is documented in BR 7 of `core/edd/event-bus`) resolve `dispatch()` regardless of handler outcome, so the relay marks the entry published even if every handler for that event threw.

## Edge Cases

- **No unpublished entries** -- `processOnce()` returns 0 immediately.
- **All dispatches fail** -- Returns 0. No entries marked published. All entries remain for retry.
- **Partial batch failure** -- Successfully dispatched entries are marked published. Failed entries remain unpublished.
- **Handler throws but dispatch() resolves** -- With a bus that isolates handler errors, the entry is still marked published; this is not treated as a dispatch failure and is not retried.
- **start() called twice** -- Second call is a no-op. Only one timer runs.
- **stop() called without start()** -- No-op.
- **stop() then start()** -- Restarts polling with a fresh timer.
- **processOnce() called concurrently** -- Second call returns 0 immediately.

## Integration Points

- **Domain** -- Creates the relay during `init()` when outbox is configured. Exposes `startOutboxRelay()`, `stopOutboxRelay()`, `processOutboxOnce()`.
- **OutboxStore** -- Read via `loadUnpublished`, written via `markPublished`.
- **EventBus** -- Events dispatched via `eventBus.dispatch()`.

## Test Scenarios

### processOnce dispatches unpublished entries and marks them published

```ts
import { describe, it, expect, vi } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";
import type { OutboxEntry, Event } from "@noddde/core";

describe("OutboxRelay", () => {
  it("should dispatch each unpublished entry and mark it published", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    const dispatched: Event[] = [];
    eventBus.on("OrderCreated", (event: Event) => dispatched.push(event));

    await store.save([
      {
        id: "e1",
        event: { name: "OrderCreated", payload: { orderId: "o1" } },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        publishedAt: null,
      },
    ]);

    const count = await relay.processOnce();

    expect(count).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.name).toBe("OrderCreated");

    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(0);
  });
});
```

### processOnce returns 0 when no unpublished entries

```ts
import { describe, it, expect } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";

describe("OutboxRelay", () => {
  it("should return 0 when there are no unpublished entries", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    const count = await relay.processOnce();
    expect(count).toBe(0);
  });
});
```

### processOnce skips failed dispatches and continues

`EventEmitterEventBus.dispatch()` isolates handler errors internally (see BR 7 of `core/edd/event-bus`) and never rejects because of a throwing handler, so this scenario exercises BR #2 with a broker-style fake bus whose `dispatch()` itself rejects — the failure mode the relay actually guards against (e.g. a Kafka/RabbitMQ/NATS adapter that fails to publish because the connection dropped).

```ts
import { describe, it, expect } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { EventBus, Event } from "@noddde/core";

describe("OutboxRelay", () => {
  it("should skip entries whose dispatch rejects and process the rest", async () => {
    const store = new InMemoryOutboxStore();
    const dispatched: Event[] = [];
    // Fake broker-style bus: dispatch() itself rejects for one event,
    // unlike EventEmitterEventBus where only handlers can throw.
    const eventBus: EventBus = {
      async dispatch(event: Event) {
        if (event.name === "FailEvent") {
          throw new Error("Broker connection dropped");
        }
        dispatched.push(event);
      },
      on() {},
      async close() {},
    };
    const relay = new OutboxRelay(store, eventBus);

    await store.save([
      {
        id: "fail",
        event: { name: "FailEvent", payload: {} },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        publishedAt: null,
      },
      {
        id: "success",
        event: { name: "SuccessEvent", payload: {} },
        createdAt: new Date("2025-01-01T00:00:01.000Z"),
        publishedAt: null,
      },
    ]);

    const count = await relay.processOnce();

    expect(count).toBe(1);
    expect(dispatched).toHaveLength(1);

    // Failed entry should still be unpublished — dispatch() rejecting is the
    // only failure mode the relay can detect and retry.
    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("fail");
  });
});
```

### processOnce marks entries published even when a handler throws

`EventBus` implementations (e.g. `EventEmitterEventBus`) isolate handler errors so that `dispatch()` resolves even if a registered handler throws — that isolation happens inside the bus, below the relay. From the relay's perspective the dispatch succeeded, so the entry is marked published; a handler failure is invisible to the relay by design and is not retried.

```ts
import { describe, it, expect } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";
import type { Event } from "@noddde/core";

describe("OutboxRelay", () => {
  it("should mark all entries published even when a handler throws", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    // Handler throws, but EventEmitterEventBus isolates handler errors so
    // dispatch() still resolves — the relay never sees the failure.
    eventBus.on("FailEvent", () => {
      throw new Error("Handler failed");
    });
    const dispatched: Event[] = [];
    eventBus.on("SuccessEvent", (event: Event) => dispatched.push(event));

    await store.save([
      {
        id: "fail",
        event: { name: "FailEvent", payload: {} },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        publishedAt: null,
      },
      {
        id: "success",
        event: { name: "SuccessEvent", payload: {} },
        createdAt: new Date("2025-01-01T00:00:01.000Z"),
        publishedAt: null,
      },
    ]);

    const count = await relay.processOnce();

    // Both entries dispatched successfully from the relay's point of view.
    expect(count).toBe(2);
    expect(dispatched).toHaveLength(1);

    // Both entries are now published — the relay has no way to detect
    // handler failure, only dispatch()-level rejection.
    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(0);
  });
});
```

### start and stop manage polling lifecycle

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";

describe("OutboxRelay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should poll at the configured interval and stop when told", async () => {
    vi.useFakeTimers();
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus, { pollIntervalMs: 100 });

    const processOnceSpy = vi.spyOn(relay, "processOnce");

    relay.start();

    // Advance time by 350ms — should trigger ~3 polls
    await vi.advanceTimersByTimeAsync(350);

    expect(processOnceSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    relay.stop();
    const callCount = processOnceSpy.mock.calls.length;

    // Advance more time — no new calls
    await vi.advanceTimersByTimeAsync(200);
    expect(processOnceSpy.mock.calls.length).toBe(callCount);
  });
});
```

### start is idempotent

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";

describe("OutboxRelay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not create multiple timers when start is called twice", async () => {
    vi.useFakeTimers();
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus, { pollIntervalMs: 100 });
    const processOnceSpy = vi.spyOn(relay, "processOnce");

    relay.start();
    relay.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(350);

    // Should have ~3 calls, not ~6
    expect(processOnceSpy.mock.calls.length).toBeLessThanOrEqual(4);

    relay.stop();
  });
});
```

### processOnce respects batchSize option

```ts
import { describe, it, expect } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";
import type { Event } from "@noddde/core";

describe("OutboxRelay", () => {
  it("should process at most batchSize entries per call", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus, { batchSize: 2 });

    const dispatched: Event[] = [];
    eventBus.on("Evt", (event: Event) => dispatched.push(event));

    await store.save(
      Array.from({ length: 5 }, (_, i) => ({
        id: `e${i}`,
        event: { name: "Evt", payload: { i } },
        createdAt: new Date(`2025-01-01T00:00:0${i}.000Z`),
        publishedAt: null,
      })),
    );

    const count = await relay.processOnce();

    expect(count).toBe(2);
    expect(dispatched).toHaveLength(2);

    // 3 entries should remain unpublished
    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(3);
  });
});
```
