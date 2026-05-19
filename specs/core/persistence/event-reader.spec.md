---
title: "EventReader & EventReadOptions"
module: core/persistence/event-reader
source_file: packages/core/src/persistence/event-reader.ts
status: implemented
exports: [EventReader, EventReadOptions]
depends_on: [core/id, core/edd/event]
docs:
  - read-model/projection-rebuild.mdx
---

# EventReader & EventReadOptions

> A read-only, append-order capability for streaming events from the event log. `EventReader` is the seam through which framework features that need to traverse the entire (or filtered) event history — most notably [projection rebuild](../../engine/projection-rebuild.spec.md) — obtain events independently of the per-aggregate `EventSourcedAggregatePersistence.load(name, id)` API. It is an **optional** capability: adapters opt in by implementing it. The engine surfaces it via the new `PersistenceAdapter.eventReader?` field, and the in-memory event-sourced persistence implements it directly.

## Type Contract

```ts
import type { ID } from "../id";
import type { Event } from "../edd/event";

/**
 * Optional filter and cursor for {@link EventReader.read}.
 *
 * v1 of the engine always calls `read({})` with no options. Adapters MAY
 * implement filtering and cursoring; the shape is reserved here so adapter
 * implementations can ship the capability ahead of engine consumers.
 */
export interface EventReadOptions {
  /**
   * Filter the stream to events belonging to aggregates of this name.
   * When omitted, events from all aggregates are streamed.
   */
  aggregateName?: string;

  /**
   * Resume after the given aggregate-version cursor. Adapter-defined
   * semantics; reserved for future use. v1 engine code does not pass this.
   */
  after?: {
    aggregateName: string;
    aggregateId: ID;
    version: number;
  };
}

/**
 * Read-only access to the global event log.
 *
 * Implementations expose every persisted event as an async iterable. The
 * engine consumes this iterable lazily — adapters SHOULD stream from
 * underlying storage (cursor / paged query / change feed) rather than
 * materializing the full log in memory.
 */
export interface EventReader {
  /**
   * Returns an async iterable that yields events in the log's append order.
   *
   * Ordering guarantees:
   *
   *  - Within a single aggregate stream `(aggregateName, aggregateId)`,
   *    events MUST be yielded in `version` order (0, 1, 2, ...).
   *
   *  - Across different aggregates, ordering is adapter-defined but MUST be
   *    stable for a single call (replaying with the same options on a frozen
   *    log returns the same sequence). Adapters that record a global
   *    sequence number SHOULD yield in that order; adapters that don't MAY
   *    interleave aggregate streams in any deterministic-for-this-call
   *    fashion.
   *
   *  - Implementations MUST yield each event at most once per call.
   *
   * Iteration is single-pass: callers MUST consume the returned iterable
   * exactly once. Re-calling `read()` is the way to start a fresh traversal.
   */
  read(options?: EventReadOptions): AsyncIterable<Event>;
}
```

- `EventReader` is an **optional** capability surfaced via `PersistenceAdapter.eventReader?` (see `specs/core/persistence/persistence.spec.md`) and, structurally, by any persistence object that implements a `read()` method (the in-memory event-sourced persistence does this).
- `EventReader.read` returns an `AsyncIterable<Event>`, NOT `Promise<Event[]>`. This is intentional — callers stream-process events without materializing the full log.
- `EventReadOptions` is `{}` in the v1 engine path. The interface reserves `aggregateName` and `after` so adapters can ship filtering/cursoring ahead of engine consumers.
- The `Event` type is the same `Event` that flows through the rest of the framework (`edd/event`) — `{ name, payload, metadata? }`. The reader does NOT enrich or strip metadata; it returns each event exactly as it was persisted.

## Behavioral Requirements

1. **`read(options?)` returns an `AsyncIterable<Event>`.** It does not return a `Promise<Event[]>`. Callers iterate with `for await (const event of reader.read())`.
2. **Per-aggregate ordering.** Events from the same `(aggregateName, aggregateId)` pair MUST be yielded in their stored `version` order. Adapters that store events with explicit per-stream sequence numbers MUST sort by that sequence. Adapters that store events in append order (in-memory `Map<string, Event[]>`) MUST yield in `Array.prototype.entries` order.
3. **Cross-aggregate ordering is adapter-defined but stable.** Implementations MAY interleave aggregate streams in any order, but the order MUST be deterministic for a single `read()` call on a frozen event log. Re-calling `read()` on the same log MUST produce the same sequence.
4. **Single-pass iteration.** Each yielded event MUST appear at most once during iteration of a returned iterable. Callers MUST NOT rewind. To re-iterate, callers MUST call `read()` again.
5. **Empty log.** When the log has no events (or the filter matches nothing), `read()` returns an iterable that immediately terminates (`for await` body runs zero times).
6. **`aggregateName` filter.** When `options.aggregateName` is provided, the iterable MUST yield only events whose `metadata?.aggregateName` equals the filter value. Events lacking aggregate-name metadata MUST NOT be yielded under a filter. (v1 engine does not exercise this path; adapters that implement filtering MUST honor it for forward-compatibility.)
7. **`after` cursor.** When `options.after` is provided, implementations MAY use it to skip events at or before the cursor. Implementations that do not support cursoring MUST throw a clear error (`new Error("EventReader: 'after' cursor is not supported by this implementation")`). v1 engine does not pass this option.
8. **No side effects.** `read` MUST NOT modify, delete, or republish events. It is a pure read.
9. **Async cleanup.** Implementations backed by external cursors (DB result sets, EventStoreDB subscriptions) SHOULD release resources when the iterable is exhausted OR when the consumer breaks out of the `for await` early. The cleanest way is via the `AsyncIterableIterator.return()` hook.

## Invariants

- `read()` does not throw synchronously for a valid input — errors during iteration surface from the `for await` loop (or from the first `next()`).
- The returned iterable yields `Event` values whose shape matches `edd/event` exactly (no field stripped, no field added).
- Two concurrent `read()` calls on the same `EventReader` instance are independent — neither affects the other's progress.
- An empty `read()` call (`reader.read()` with no arg) is equivalent to `reader.read({})`.

## Edge Cases

- **Log mutated during iteration.** If new events are persisted while a consumer is iterating, the implementation MAY include or omit them — the framework's projection-rebuild flow detaches projection subscriptions and instructs callers to halt writes, so this edge is mostly theoretical. Adapters SHOULD document their choice.
- **Aggregates with zero events.** Filtering by an `aggregateName` that has no recorded events yields an empty iterable.
- **Events missing `metadata.aggregateName`.** An `aggregateName` filter MUST skip these. Without a filter, they MUST be yielded.
- **Mixed event names.** The reader yields events of all `name` values; the consumer is responsible for filtering by event name.

## Integration Points

- `PersistenceAdapter.eventReader?` (see `specs/core/persistence/persistence.spec.md`): adapters opt in by populating this field.
- `Domain.rebuildProjection` (see `specs/engine/projection-rebuild.spec.md`) resolves an `EventReader` from the wired adapter OR from the resolved event-sourced persistence (if the persistence object structurally implements `read`).
- `InMemoryEventSourcedAggregatePersistence` (see `specs/engine/implementations/in-memory-aggregate-persistence.spec.md`) implements `EventReader` so the in-memory path supports rebuild without an explicit adapter.

## Test Scenarios

### EventReader interface is assignable from a conforming object

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventReader, Event } from "@noddde/core";

describe("EventReader interface", () => {
  it("should accept a conforming object as EventReader", () => {
    const reader: EventReader = {
      read: () =>
        (async function* () {
          yield { name: "X", payload: {} } as Event;
        })(),
    };
    expectTypeOf(reader.read).toBeFunction();
    expectTypeOf<ReturnType<typeof reader.read>>().toMatchTypeOf<
      AsyncIterable<Event>
    >();
  });
});
```

### read() yields events in append order for a single aggregate

```ts
import { describe, it, expect } from "vitest";
import type { EventReader, Event } from "@noddde/core";

describe("EventReader per-aggregate ordering", () => {
  function createReaderFromArray(events: Event[]): EventReader {
    return {
      read: () =>
        (async function* () {
          for (const e of events) yield e;
        })(),
    };
  }

  it("should yield events in the order they were stored", async () => {
    const events: Event[] = [
      {
        name: "A",
        payload: { i: 0 },
        metadata: { aggregateName: "X", aggregateId: "1" } as any,
      },
      {
        name: "A",
        payload: { i: 1 },
        metadata: { aggregateName: "X", aggregateId: "1" } as any,
      },
      {
        name: "A",
        payload: { i: 2 },
        metadata: { aggregateName: "X", aggregateId: "1" } as any,
      },
    ];
    const reader = createReaderFromArray(events);

    const seen: number[] = [];
    for await (const e of reader.read()) {
      seen.push((e.payload as { i: number }).i);
    }
    expect(seen).toEqual([0, 1, 2]);
  });
});
```

### read() on an empty log yields nothing

```ts
import { describe, it, expect } from "vitest";
import type { EventReader } from "@noddde/core";

describe("EventReader empty log", () => {
  it("should produce an iterable that immediately terminates", async () => {
    const reader: EventReader = {
      read: () =>
        (async function* () {
          // yields nothing
        })(),
    };
    let count = 0;
    for await (const _ of reader.read()) count++;
    expect(count).toBe(0);
  });
});
```

### read() returns AsyncIterable (typing)

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventReader, Event } from "@noddde/core";

describe("EventReader.read return type", () => {
  it("should return AsyncIterable<Event>", () => {
    type ReadReturn = ReturnType<EventReader["read"]>;
    expectTypeOf<ReadReturn>().toEqualTypeOf<AsyncIterable<Event>>();
  });
});
```

### EventReadOptions accepts aggregateName and after

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventReadOptions, ID } from "@noddde/core";

describe("EventReadOptions", () => {
  it("should allow an aggregateName filter", () => {
    const opts: EventReadOptions = { aggregateName: "Order" };
    expectTypeOf(opts.aggregateName).toEqualTypeOf<string | undefined>();
  });

  it("should allow an after cursor", () => {
    const opts: EventReadOptions = {
      after: {
        aggregateName: "Order",
        aggregateId: "1" as ID,
        version: 5,
      },
    };
    expectTypeOf(opts.after).toMatchTypeOf<
      | { aggregateName: string; aggregateId: ID; version: number }
      | undefined
    >();
  });

  it("should allow an empty options object", () => {
    const opts: EventReadOptions = {};
    expectTypeOf(opts).toMatchTypeOf<EventReadOptions>();
  });
});
```

### read() called with no options is equivalent to read({})

```ts
import { describe, it, expect } from "vitest";
import type { EventReader, Event } from "@noddde/core";

describe("EventReader.read no-arg equivalence", () => {
  it("should produce the same sequence as read({})", async () => {
    const events: Event[] = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
    ];
    let callCount = 0;
    const reader: EventReader = {
      read: () => {
        callCount++;
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    };

    const seqA: string[] = [];
    for await (const e of reader.read()) seqA.push(e.name);

    const seqB: string[] = [];
    for await (const e of reader.read({})) seqB.push(e.name);

    expect(seqA).toEqual(seqB);
    expect(callCount).toBe(2);
  });
});
```

### Two concurrent read() iterators are independent

```ts
import { describe, it, expect } from "vitest";
import type { EventReader, Event } from "@noddde/core";

describe("EventReader concurrent iteration", () => {
  it("should allow two iterators to progress independently", async () => {
    const events: Event[] = [
      { name: "A", payload: { i: 0 } },
      { name: "A", payload: { i: 1 } },
      { name: "A", payload: { i: 2 } },
    ];
    const reader: EventReader = {
      read: () =>
        (async function* () {
          for (const e of events) yield e;
        })(),
    };

    const iter1 = reader.read()[Symbol.asyncIterator]();
    const iter2 = reader.read()[Symbol.asyncIterator]();

    const a = await iter1.next();
    const b = await iter2.next();
    expect((a.value as Event).payload).toEqual({ i: 0 });
    expect((b.value as Event).payload).toEqual({ i: 0 });

    const a2 = await iter1.next();
    expect((a2.value as Event).payload).toEqual({ i: 1 });
    // iter2 is still at index 1 from its own perspective
    const b2 = await iter2.next();
    expect((b2.value as Event).payload).toEqual({ i: 1 });
  });
});
```
