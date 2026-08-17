---
title: "EventIdempotencyStore & withIdempotency"
module: edd/event-idempotency
source_file: packages/core/src/edd/event-idempotency.ts
status: implemented
exports: [EventIdempotencyStore, WithIdempotencyOptions, withIdempotency]
depends_on: [edd/event, edd/event-handler, infrastructure/index]
docs: [] # TODO: no docs page yet
---

# EventIdempotencyStore & withIdempotency

> Framework-level primitive for deduplicating **event handler invocations** caused by at-least-once broker redelivery (Kafka, RabbitMQ). `EventIdempotencyStore` tracks which dedup keys have already been processed. `withIdempotency` wraps any `EventHandler` so redelivered events are detected and skipped instead of re-running side effects.
>
> This is a **different concern** from `IdempotencyStore` (`core/persistence/idempotency`), which deduplicates **commands** re-dispatched to the command bus. That primitive is keyed by `commandId` and is enlisted in the aggregate's Unit of Work. `EventIdempotencyStore` is keyed by an event-derived string and has no aggregate/UoW coupling — it's a standalone side-store for the event-handling side of the framework. The two stores are independently configured and never share records.

## Type Contract

```ts
import type { Event } from "./event";
import type { EventHandler } from "./event-handler";
import type { Infrastructure } from "../infrastructure";

/**
 * Storage interface for tracking which event-handler dedup keys have
 * already been processed. Used by {@link withIdempotency} to skip
 * redelivered events under at-least-once delivery semantics.
 */
export interface EventIdempotencyStore {
  /**
   * Checks whether the given key has already been recorded as processed.
   * Returns `true` if a non-expired record exists, `false` otherwise.
   */
  hasProcessed(key: string): Promise<boolean>;

  /**
   * Records the given key as processed. Idempotent: recording the same
   * key twice has no additional effect (the second call is a no-op or
   * overwrite, implementation's choice — both are observably identical
   * since the record's presence, not its exact timestamp, is what
   * `hasProcessed` reads).
   */
  markProcessed(key: string): Promise<void>;

  /**
   * Removes all records older than `ttlMs`. An operational/maintenance
   * method — never called automatically by `withIdempotency`. Callers
   * that need bounded storage growth should invoke this periodically
   * (e.g. from a cron job or background process).
   */
  removeExpired(ttlMs: number): Promise<void>;
}

/** Options for {@link withIdempotency}. */
export interface WithIdempotencyOptions<TEvent extends Event> {
  /**
   * Derives the dedup key from the event. Defaults to
   * `event.metadata?.eventId`. Provide this when events don't carry a
   * stable `eventId`, or when dedup should be scoped differently (e.g.
   * derived from payload fields).
   */
  // eslint-disable-next-line no-unused-vars
  key?: (event: TEvent) => string;
}

/**
 * Wraps an {@link EventHandler} so redelivered events (same dedup key)
 * are detected via `store` and skipped instead of re-invoking the
 * handler. See Behavioral Requirements for the exact skip/mark ordering.
 */
export function withIdempotency<
  TEvent extends Event,
  TInfrastructure extends Infrastructure,
>(
  handler: EventHandler<TEvent, TInfrastructure>,
  store: EventIdempotencyStore,
  options?: WithIdempotencyOptions<TEvent>,
): EventHandler<TEvent, TInfrastructure>;
```

## Behavioral Requirements

1. **Default key derivation** -- When `options.key` is not provided, the dedup key is `event.metadata?.eventId`. When `options.key` is provided, it takes precedence and is called with the full event to derive the key.
2. **Missing key surfaces loudly** -- If no key can be derived (no `options.key` and `event.metadata?.eventId` is `undefined`), the wrapped handler's returned promise rejects with a descriptive error (mentioning `withIdempotency` and that no dedup key could be derived). The underlying handler is NOT invoked and `store.hasProcessed`/`store.markProcessed` are NOT called. This is a configuration error that must be visible, not silently swallowed.
3. **Skip when already processed** -- Before invoking the underlying handler, the wrapper calls `store.hasProcessed(key)`. If it resolves `true`, the wrapped handler resolves immediately without invoking the underlying handler, and without calling `store.markProcessed` again.
4. **Invoke handler when not processed** -- If `store.hasProcessed(key)` resolves `false`, the underlying handler is invoked with the original `(event, infrastructure)` arguments.
5. **Mark processed only after success** -- `store.markProcessed(key)` is called only after the underlying handler's returned promise resolves (or its synchronous return completes without throwing). If the underlying handler throws or its promise rejects, `store.markProcessed` is NOT called, and the rejection propagates from the wrapped handler unchanged. This preserves broker redelivery semantics: a failed attempt is not "processed," so the next redelivery will retry it for real.
6. **Store errors propagate** -- If `store.hasProcessed` or `store.markProcessed` rejects, the wrapped handler's promise rejects with that error. `withIdempotency` does not swallow store failures — a store outage surfaces as a handler failure (safe default: the broker redelivers and the underlying side effect may run again, which is the pre-existing at-least-once behavior without this wrapper).
7. **No exactly-once guarantee** -- `withIdempotency` performs a check-then-act sequence (`hasProcessed` then, later, `markProcessed`) with no locking. Two concurrent redeliveries of the same key arriving before the first `markProcessed()` call completes may both invoke the underlying handler. This is a documented best-effort dedup for the common case (sequential per-partition/per-queue redelivery), not a distributed lock. Handlers wrapped with `withIdempotency` should still be written defensively for true exactly-once needs.
8. **Pure composition** -- `withIdempotency` returns a new function; it does not mutate the `handler` argument. The returned function has the exact same `EventHandler<TEvent, TInfrastructure>` type as the input, so it's a drop-in replacement anywhere an `EventHandler` is expected (e.g. `defineDomain({ eventHandlers: { ... } })`).

## Invariants

- The dedup key passed to `store.hasProcessed`/`store.markProcessed` is always a `string`.
- `store.markProcessed` is never called before the underlying handler has completed successfully.
- `withIdempotency` never calls the underlying handler more than once per invocation of the wrapped handler (it either skips entirely or calls it exactly once).
- The wrapped handler's parameter and return types are identical to the input handler's (`EventHandler<TEvent, TInfrastructure>`).

## Edge Cases

- **No `eventId` and no `options.key`**: Wrapped handler rejects with a descriptive error; underlying handler and store are never touched.
- **`store.hasProcessed` returns `true`**: Underlying handler is skipped entirely; wrapped handler resolves `undefined`.
- **`store.hasProcessed` returns `false`**: Underlying handler runs normally.
- **Underlying handler throws synchronously**: Treated the same as a rejected promise — `store.markProcessed` is not called, error propagates.
- **Underlying handler resolves successfully**: `store.markProcessed(key)` is awaited before the wrapped handler resolves.
- **Custom `options.key` returns the same value for two different events**: They are treated as duplicates of each other — this is a caller responsibility, not validated by `withIdempotency`.
- **`store.hasProcessed` rejects**: Wrapped handler rejects with that error; underlying handler is never invoked.
- **`store.markProcessed` rejects after a successful handler run**: Wrapped handler rejects with that error, even though the side effect already ran — callers relying on strict "handler ran ⇒ resolved" semantics should treat a `markProcessed` failure as "ran once, dedup bookkeeping failed" (a future redelivery may re-run the handler).

## Integration Points

- Designed to wrap handlers passed to `defineDomain({ eventHandlers: { EventName: withIdempotency(handler, store) } })` — see `core/edd/event-handler` for the `EventHandler` shape and `engine/domain` for how `eventHandlers` are wired to the configured `EventBus`.
- Addresses `packages/testing-integration/ROBUSTNESS.md` §2.7: Kafka and RabbitMQ both redeliver on handler failure; this primitive gives users a documented, tested way to detect and skip the resulting duplicate delivery instead of rolling their own.
- See `engine/implementations/in-memory-event-idempotency-store` for a development-only in-memory `EventIdempotencyStore`, and the `@noddde/typeorm`, `@noddde/drizzle`, `@noddde/prisma` adapters for durable DB-backed implementations.
- Unrelated to `core/persistence/idempotency`'s `IdempotencyStore`/`IdempotencyRecord`, which deduplicate command dispatch, not event handling.

## Test Scenarios

### withIdempotency skips the handler when the store reports the key as already processed

```ts
import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should not invoke the underlying handler when hasProcessed resolves true", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(true),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: {},
      metadata: { eventId: "evt-1" } as any,
    };

    await wrapped(event, {});

    expect(store.hasProcessed).toHaveBeenCalledWith("evt-1");
    expect(handler).not.toHaveBeenCalled();
    expect(store.markProcessed).not.toHaveBeenCalled();
  });
});
```

### withIdempotency invokes the handler and marks the key processed when not previously seen

```ts
import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should invoke the handler then mark the key processed", async () => {
    const calls: string[] = [];
    const handler = vi.fn(async () => {
      calls.push("handler");
    });
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockImplementation(async () => {
        calls.push("markProcessed");
      }),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: { foo: "bar" },
      metadata: { eventId: "evt-2" } as any,
    };
    const infra = { logger: undefined } as any;

    await wrapped(event, infra);

    expect(handler).toHaveBeenCalledWith(event, infra);
    expect(store.markProcessed).toHaveBeenCalledWith("evt-2");
    expect(calls).toEqual(["handler", "markProcessed"]);
  });
});
```

### withIdempotency does not mark the key processed when the handler throws

```ts
import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should propagate the handler's rejection without marking the key processed", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler failed"));
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: {},
      metadata: { eventId: "evt-3" } as any,
    };

    await expect(wrapped(event, {})).rejects.toThrow("handler failed");
    expect(store.markProcessed).not.toHaveBeenCalled();
  });
});
```

### withIdempotency uses a custom key function when provided

```ts
import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should derive the dedup key from options.key instead of event.metadata.eventId", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store, {
      key: (event) => `order-${(event.payload as any).orderId}`,
    });
    const event: Event = {
      name: "OrderPlaced",
      payload: { orderId: "o-42" },
      metadata: { eventId: "evt-4" } as any,
    };

    await wrapped(event, {});

    expect(store.hasProcessed).toHaveBeenCalledWith("order-o-42");
    expect(store.markProcessed).toHaveBeenCalledWith("order-o-42");
  });
});
```

### withIdempotency rejects when no eventId and no custom key function are available

```ts
import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should reject with a descriptive error and never touch the store or handler", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = { name: "Test", payload: {} };

    await expect(wrapped(event, {})).rejects.toThrow(/withIdempotency/i);
    expect(handler).not.toHaveBeenCalled();
    expect(store.hasProcessed).not.toHaveBeenCalled();
    expect(store.markProcessed).not.toHaveBeenCalled();
  });
});
```

### withIdempotency propagates a hasProcessed store failure without invoking the handler

```ts
import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should reject when store.hasProcessed rejects, without calling the handler", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockRejectedValue(new Error("store unavailable")),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: {},
      metadata: { eventId: "evt-5" } as any,
    };

    await expect(wrapped(event, {})).rejects.toThrow("store unavailable");
    expect(handler).not.toHaveBeenCalled();
  });
});
```
