---
title: "MetadataEnricher"
module: engine/executors/metadata-enricher
source_file: packages/engine/src/executors/metadata-enricher.ts
status: implemented
exports: []
depends_on:
  - edd/event
  - edd/event-metadata
---

# MetadataEnricher

> `MetadataEnricher` enriches raw events produced by command handlers with metadata (eventId, timestamp, correlationId, causationId, userId, aggregate context, and sequenceNumber). It merges three metadata sources in priority order: (1) `withMetadataContext` override (highest), (2) configured `MetadataProvider` callback, (3) auto-generated defaults (lowest). This is an engine-internal class used by `CommandLifecycleExecutor`.

## Type Contract

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { Event, ID } from "@noddde/core";
import type { MetadataContext, MetadataProvider } from "../domain";

class MetadataEnricher {
  constructor(
    metadataStorage: AsyncLocalStorage<MetadataContext>,
    metadataProvider?: MetadataProvider,
  );

  enrich(
    events: Event[],
    aggregateName: string,
    aggregateId: ID,
    version: number,
    causationFallback: string,
  ): Event[];
}
```

- `MetadataEnricher` is constructed with an `AsyncLocalStorage<MetadataContext>` (for override context) and an optional `MetadataProvider` callback.
- `enrich` receives raw events (no metadata), aggregate context, the current version, and a fallback causation string (typically the command name). It returns new event objects with fully populated `EventMetadata`.

## Behavioral Requirements

### Metadata Merging Priority

1. **Three sources, merged in priority order** -- The enricher resolves metadata from three sources:
   - **Auto-generated defaults** (lowest priority): `eventId` (UUID v7), `timestamp` (ISO 8601), `correlationId` (UUID v7).
   - **MetadataProvider callback** (medium priority): called once per `enrich` invocation. The returned `MetadataContext` values override the auto-generated defaults for `correlationId`, `causationId`, and `userId`.
   - **Override context** from `AsyncLocalStorage` (highest priority): values from `withMetadataContext` override both the provider and auto-generated defaults.
2. **Merge order** -- The provider context is spread first, then the override context is spread on top: `{ ...providerCtx, ...overrideCtx }`. The merged context provides `correlationId`, `causationId`, and `userId`.

### Auto-Generated Fields

3. **eventId** -- Each event receives a unique UUID v7 as its `eventId`. This is always auto-generated and cannot be overridden by the provider or context.
4. **timestamp** -- Each event receives an ISO 8601 timestamp from `new Date().toISOString()`. This is always auto-generated and cannot be overridden.
5. **correlationId** -- Uses `mergedCtx.correlationId` if present. Falls back to a new UUID v7 if neither the provider nor the override context supplies one.

### Causation and User

6. **causationId** -- Uses `mergedCtx.causationId` if present. Falls back to the `causationFallback` parameter (typically the command name).
7. **userId** -- Uses `mergedCtx.userId` if present. May be `undefined` if neither source provides it.

### Aggregate Context and Sequencing

8. **aggregateName** -- Set to the `aggregateName` parameter on every enriched event.
9. **aggregateId** -- Set to the `aggregateId` parameter on every enriched event.
10. **sequenceNumber** -- Computed as `version + index + 1` where `version` is the aggregate version before these events and `index` is the event's position in the array. The first event gets `version + 1`, the second `version + 2`, etc.

### Immutability

11. **Returns new event objects** -- The original event objects are not mutated. Each enriched event is a shallow copy (`{ ...event, metadata: { ... } }`) with the metadata attached.

## Invariants

- `eventId` is always a UUID v7 -- never null, never overridden by context.
- `timestamp` is always an ISO 8601 string -- never null, never overridden by context.
- `correlationId` is always a string -- either from context/provider or auto-generated.
- `causationId` is always a string -- either from context/provider or from `causationFallback`.
- `sequenceNumber` is always `version + index + 1` -- deterministic from inputs.
- The enricher never mutates the input event array or individual event objects.
- The provider callback is invoked at most once per `enrich` call (not once per event).
- If the provider is `undefined`, provider context is `{}`.
- If no override context is in the `AsyncLocalStorage`, override context is `{}`.

## Edge Cases

- **No provider, no override context** -- All metadata is auto-generated. `userId` is `undefined`. `causationId` equals `causationFallback`.
- **Provider returns empty object** -- Same as no provider: auto-generated defaults apply.
- **Override context with only `correlationId`** -- Provider's `causationId` and `userId` still apply; only `correlationId` is overridden.
- **Empty events array** -- Returns an empty array. No provider call side effects observed.
- **Single event** -- Returned as a single-element array with `sequenceNumber = version + 1`.
- **Multiple events** -- Each gets a distinct `eventId` and incrementing `sequenceNumber`, but they share the same `correlationId`, `causationId`, `userId`, `aggregateName`, and `aggregateId`.
- **Provider throws** -- The error propagates to the caller (not caught by the enricher).
- **Version is 0** -- First event gets `sequenceNumber = 1`.

## Integration Points

- **CommandLifecycleExecutor** -- The sole consumer. Calls `enrich` after the apply phase to attach metadata to events before enlisting persistence.
- **Domain** -- Constructs the `MetadataEnricher` during `init()` with the domain's `AsyncLocalStorage<MetadataContext>` and the configured `MetadataProvider`.
- **EventMetadata** -- The enricher populates all fields of the `EventMetadata` interface: `eventId`, `timestamp`, `correlationId`, `causationId`, `userId`, `aggregateName`, `aggregateId`, `sequenceNumber`.

## Test Scenarios

### enrich attaches auto-generated metadata when no provider or context is set

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should auto-generate eventId, timestamp, correlationId, and use causationFallback", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "ThingCreated", payload: { id: "t1" } },
    ];

    const enriched = enricher.enrich(events, "Thing", "t1", 0, "CreateThing");

    expect(enriched).toHaveLength(1);
    const meta = enriched[0]!.metadata!;
    expect(meta.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(meta.causationId).toBe("CreateThing");
    expect(meta.userId).toBeUndefined();
    expect(meta.aggregateName).toBe("Thing");
    expect(meta.aggregateId).toBe("t1");
    expect(meta.sequenceNumber).toBe(1);
  });
});
```

### enrich uses provider values for correlationId, causationId, and userId

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should use provider values when no override context is set", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const provider = () => ({
      correlationId: "provider-corr",
      causationId: "provider-cause",
      userId: "user-42",
    });
    const enricher = new MetadataEnricher(storage, provider);

    const events = [{ name: "ItemAdded", payload: { qty: 1 } }];
    const enriched = enricher.enrich(events, "Cart", "c1", 5, "AddItem");

    const meta = enriched[0]!.metadata!;
    expect(meta.correlationId).toBe("provider-corr");
    expect(meta.causationId).toBe("provider-cause");
    expect(meta.userId).toBe("user-42");
  });
});
```

### enrich override context takes priority over provider

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should override provider values with context values", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const provider = () => ({
      correlationId: "provider-corr",
      causationId: "provider-cause",
      userId: "provider-user",
    });
    const enricher = new MetadataEnricher(storage, provider);

    const events = [{ name: "ItemAdded", payload: { qty: 1 } }];

    storage.run(
      { correlationId: "override-corr", userId: "override-user" },
      () => {
        const enriched = enricher.enrich(events, "Cart", "c1", 0, "AddItem");
        const meta = enriched[0]!.metadata!;
        expect(meta.correlationId).toBe("override-corr");
        expect(meta.userId).toBe("override-user");
        // causationId falls through to provider since not in override
        expect(meta.causationId).toBe("provider-cause");
      },
    );
  });
});
```

### enrich assigns incrementing sequenceNumber across multiple events

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should assign sequenceNumber = version + index + 1 for each event", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
      { name: "C", payload: {} },
    ];

    const enriched = enricher.enrich(events, "Agg", "a1", 10, "DoStuff");

    expect(enriched[0]!.metadata!.sequenceNumber).toBe(11);
    expect(enriched[1]!.metadata!.sequenceNumber).toBe(12);
    expect(enriched[2]!.metadata!.sequenceNumber).toBe(13);
  });
});
```

### enrich does not mutate original events

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should return new event objects without mutating originals", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const original = { name: "Created", payload: { id: "x" } };
    const events = [original];

    const enriched = enricher.enrich(events, "Agg", "x", 0, "Create");

    expect(enriched[0]).not.toBe(original);
    expect(original.metadata).toBeUndefined();
    expect(enriched[0]!.metadata).toBeDefined();
    // Original payload preserved in enriched copy
    expect(enriched[0]!.payload).toEqual({ id: "x" });
    expect(enriched[0]!.name).toBe("Created");
  });
});
```

### enrich returns empty array for empty input

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should return an empty array when given no events", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const enriched = enricher.enrich([], "Agg", "a1", 0, "Cmd");

    expect(enriched).toEqual([]);
  });
});
```

### enrich generates unique eventId for each event

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should generate distinct eventIds for each event in a batch", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
    ];

    const enriched = enricher.enrich(events, "Agg", "a1", 0, "Cmd");

    expect(enriched[0]!.metadata!.eventId).not.toBe(
      enriched[1]!.metadata!.eventId,
    );
  });
});
```

### enrich shares correlationId across all events in a batch

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should use the same correlationId for all events in a batch", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
      { name: "C", payload: {} },
    ];

    const enriched = enricher.enrich(events, "Agg", "a1", 0, "Cmd");

    const corrId = enriched[0]!.metadata!.correlationId;
    expect(enriched[1]!.metadata!.correlationId).toBe(corrId);
    expect(enriched[2]!.metadata!.correlationId).toBe(corrId);
  });
});
```
