---
title: "EventMetadata"
module: edd/event-metadata
source_file: packages/core/src/edd/event-metadata.ts
status: implemented
exports: [EventMetadata]
depends_on: []
docs:
  - events/event-metadata.mdx
---

# EventMetadata

> `EventMetadata` is the metadata envelope attached to domain events by the framework at dispatch time. It carries audit, tracing, and sequencing information that enables correlation across aggregates/sagas, compliance audit trails, and event store ordering. Command handlers never produce metadata — the engine auto-populates it.

## Type Contract

- **`EventMetadata`** is an interface with:
  - `eventId: string` — globally unique event identifier (UUID v7, time-ordered).
  - `timestamp: string` — ISO 8601 timestamp of when the event was produced.
  - `correlationId: string` — traces a user action across aggregates and sagas. All events in a causal chain share the same correlationId.
  - `causationId: string` — ID of the command or event that directly caused this event.
  - `userId?: string` — who initiated the action (set via metadata context).
  - `version?: number` — event schema version for future evolution support.
  - `aggregateName?: string` — which aggregate type produced this event.
  - `aggregateId?: string` — which aggregate instance produced this event.
  - `sequenceNumber?: number` — position in the aggregate's event stream.

## Behavioral Requirements

1. `EventMetadata` is a structural interface — any object with the required fields satisfies it.
2. The four required fields (`eventId`, `timestamp`, `correlationId`, `causationId`) must always be present.
3. The five optional fields (`userId`, `version`, `aggregateName`, `aggregateId`, `sequenceNumber`) may be omitted.
4. `eventId` is expected to be a UUID v7 string (time-ordered), but the type system does not enforce the format — it is `string`.
5. `timestamp` is expected to be an ISO 8601 string, but the type system does not enforce the format — it is `string`.

## Invariants

- All four required fields are non-optional (`string`, not `string | undefined`).
- All five optional fields use the `?` modifier.
- The interface has no methods — it is a pure data shape.

## Edge Cases

- **Minimal metadata**: An object with only the 4 required fields satisfies `EventMetadata`.
- **Full metadata**: An object with all 9 fields satisfies `EventMetadata`.
- **Extra fields**: TypeScript structural typing allows extra properties when assigned to `EventMetadata`.

## Integration Points

- `EventMetadata` is referenced by `Event.metadata?` — the optional metadata field on all events.
- The engine's `Domain` class populates `EventMetadata` during command dispatch (not defined in this spec).
- Persistence layers store and retrieve metadata alongside events (not defined in this spec).

## Test Scenarios

### EventMetadata accepts minimal required fields

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventMetadata } from "@noddde/core";

describe("EventMetadata", () => {
  it("should accept an object with only required fields", () => {
    const metadata: EventMetadata = {
      eventId: "0190a6e0-0000-7000-8000-000000000001",
      timestamp: "2024-01-01T00:00:00.000Z",
      correlationId: "corr-1",
      causationId: "cmd-1",
    };
    expectTypeOf(metadata).toMatchTypeOf<EventMetadata>();
  });

  it("should have string types for required fields", () => {
    expectTypeOf<EventMetadata["eventId"]>().toBeString();
    expectTypeOf<EventMetadata["timestamp"]>().toBeString();
    expectTypeOf<EventMetadata["correlationId"]>().toBeString();
    expectTypeOf<EventMetadata["causationId"]>().toBeString();
  });
});
```

### EventMetadata accepts all optional fields

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventMetadata } from "@noddde/core";

describe("EventMetadata optional fields", () => {
  it("should accept an object with all fields", () => {
    const metadata: EventMetadata = {
      eventId: "0190a6e0-0000-7000-8000-000000000001",
      timestamp: "2024-01-01T00:00:00.000Z",
      correlationId: "corr-1",
      causationId: "cmd-1",
      userId: "user-42",
      version: 1,
      aggregateName: "BankAccount",
      aggregateId: "acc-1",
      sequenceNumber: 5,
    };
    expectTypeOf(metadata).toMatchTypeOf<EventMetadata>();
  });

  it("should have correct types for optional fields", () => {
    expectTypeOf<EventMetadata["userId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<EventMetadata["version"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<EventMetadata["aggregateName"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<EventMetadata["aggregateId"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<EventMetadata["sequenceNumber"]>().toEqualTypeOf<
      number | undefined
    >();
  });
});
```

### EventMetadata required fields cannot be omitted

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventMetadata } from "@noddde/core";

describe("EventMetadata required fields", () => {
  it("should not allow omitting eventId", () => {
    expectTypeOf<{
      timestamp: string;
      correlationId: string;
      causationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });

  it("should not allow omitting timestamp", () => {
    expectTypeOf<{
      eventId: string;
      correlationId: string;
      causationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });

  it("should not allow omitting correlationId", () => {
    expectTypeOf<{
      eventId: string;
      timestamp: string;
      causationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });

  it("should not allow omitting causationId", () => {
    expectTypeOf<{
      eventId: string;
      timestamp: string;
      correlationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });
});
```
