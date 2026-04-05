---
title: "[ProjectionName] Projection"
module: ddd/[projection-name]
source_file: packages/[package]/src/[path]/[projection-name].ts
status: draft
exports: [[ProjectionName], [ProjectionName]Types]
depends_on:
  - core/ddd/projection
  - core/edd/event
  - core/cqrs/query
docs: []  # Documentation pages covering this module (paths relative to packages/docs/content/docs/)
---

# [ProjectionName] Projection

> [1-2 sentence summary of what read model this projection builds, what events it reacts to, and what queries it serves.]

## Type Contract

### View

<!--
  Define the read-optimized view model this projection builds.
  This is the denormalized data structure tailored for specific query needs.
-->

```ts
type [ProjectionName]View = {
  // TODO: Define your view shape
  // Example:
  // items: Array<{ id: string; name: string; status: string }>;
  // totalCount: number;
  // lastUpdated: Date;
};
```

### Events

<!--
  List all events this projection reacts to. These are typically events from
  one or more aggregates. Use a union type if subscribing to multiple aggregates.
-->

```ts
import type { DefineEvents } from "@noddde/core";

// If subscribing to events from a single aggregate, import its event type:
// type [ProjectionName]Event = [AggregateName]Event;

// If subscribing to events from multiple aggregates:
// type [ProjectionName]Event = OrderEvent | PaymentEvent | ShippingEvent;

type [ProjectionName]Event = DefineEvents<{
  // TODO: List the events this projection handles
  // Example:
  // ItemCreated: { id: string; name: string };
  // ItemUpdated: { id: string; name: string };
  // ItemDeleted: { id: string };
}>;
```

### Queries

<!--
  Define all queries this projection can answer.
  Use DefineQueries to declare the query name, payload, and result type.
  Omit payload for queries that take no parameters.
-->

```ts
import type { DefineQueries } from "@noddde/core";

type [ProjectionName]Query = DefineQueries<{
  // TODO: Define your queries
  // Example:
  // GetItemById: { payload: { id: string }; result: ItemView | null };
  // ListItems: { result: ItemView[] };
  // GetItemCount: { result: number };
}>;
```

### Ports

<!--
  Define external dependencies for query handlers (e.g., database connections).
  Reduce handlers do not receive infrastructure -- only query handlers do.
-->

```ts
import type { Ports } from "@noddde/core";

interface [ProjectionName]Ports extends Ports {
  // TODO: Define external dependencies for query handlers, or use {} for none
  // Example:
  // viewStore: { get(id: string): Promise<ItemView | null>; list(): Promise<ItemView[]> };
}
```

### ProjectionTypes Bundle

```ts
type [ProjectionName]Types = {
  events: [ProjectionName]Event;
  queries: [ProjectionName]Query;
  view: [ProjectionName]View;
  ports: [ProjectionName]Ports;
};
```

## Behavioral Requirements

### On Map Handlers

<!--
  For each event, describe how the view is updated.
  Each entry in the `on` map has a `reduce` function that receives the full event object (not just payload) and the current view.
  It returns the new view (or a Promise of it).
  Each entry may also have an optional `id` function to derive a view identity from the event.
  Note: The first invocation may receive `undefined` as the view if no initial view is set.
  The `on` map is partial -- not all events need to be handled.
-->

- **[EventName]**: [How the view changes. What fields are updated/added/removed.]

### Query Handlers

<!--
  For each query, describe what data is returned and from where.
  Query handlers receive the query payload and infrastructure.
-->

- **[QueryName]**: [What this query returns. How it reads from the view or infrastructure.]

## Invariants

<!--
  List properties that must always hold for the view after any reduce handler runs.
-->

- [ ] [Invariant 1: e.g., "The items array never contains duplicates by id."]
- [ ] [Invariant 2: e.g., "totalCount always equals items.length."]

## Edge Cases

<!--
  Describe unusual scenarios and how the projection handles them.
-->

- **View is undefined on first event**: Reduce handlers must handle `undefined` view (e.g., provide defaults).
- **Duplicate events**: [How duplicate event delivery is handled (idempotent reduce handlers, etc.).]
- **[Edge case]**: [How it is handled.]

## Integration Points

<!--
  Describe where events come from and how queries are consumed.
-->

- Events come from: [aggregate names that produce these events].
- Queries are dispatched by: [UI, API handlers, sagas, etc.].

## Projection Definition

```ts
import { defineProjection } from "@noddde/core";

const [ProjectionName] = defineProjection<[ProjectionName]Types>({
  on: {
    // TODO: Implement on map handlers
    // [EventName]: {
    //   id: (event) => event.payload.id,  // optional: derive view identity from event
    //   reduce: (event, view) => {
    //     return {
    //       ...view,
    //       // update view based on event
    //     };
    //   },
    // },
  },
  queryHandlers: {
    // TODO: Implement query handlers
    // [QueryName]: (payload, ports) => {
    //   return /* query result */;
    // },
  },
});
```

## Test Scenarios

### Reduce handler produces correct view update

```ts
import { describe, it, expect } from "vitest";
import { defineProjection } from "@noddde/core";

describe("[ProjectionName] on map handlers", () => {
  // TODO: Import or inline your projection definition

  it("should update view when [EventName] is received", () => {
    const projection = /* your projection definition */;
    const initialView = undefined; // or a starting view

    const updatedView = projection.on.[EventName]!.reduce(
      {
        name: "[EventName]",
        payload: { /* TODO */ },
      },
      initialView,
    );

    expect(updatedView).toEqual(/* expected view */);
  });
});
```

### Sequential events produce cumulative view

```ts
import { describe, it, expect } from "vitest";

describe("[ProjectionName] cumulative updates", () => {
  it("should accumulate state across multiple events", () => {
    const projection = /* your projection definition */;

    let view = undefined;

    view = projection.on.[EventName1]!.reduce(
      { name: "[EventName1]", payload: { /* TODO */ } },
      view,
    );

    view = projection.on.[EventName2]!.reduce(
      { name: "[EventName2]", payload: { /* TODO */ } },
      view,
    );

    expect(view).toEqual(/* expected cumulative view */);
  });
});
```

### Query handler returns expected result

```ts
import { describe, it, expect } from "vitest";

describe("[ProjectionName] query handlers", () => {
  it("should return [expected result] for [QueryName]", async () => {
    const projection = /* your projection definition */;

    const result = await projection.queryHandlers.[QueryName]?.(
      { /* query payload */ },
      { /* infrastructure */ },
    );

    expect(result).toEqual(/* expected result */);
  });
});
```

### Reduce handler handles undefined view on first event

```ts
import { describe, it, expect } from "vitest";

describe("[ProjectionName] first event handling", () => {
  it("should handle undefined view gracefully", () => {
    const projection = /* your projection definition */;

    const view = projection.on.[EventName]!.reduce(
      { name: "[EventName]", payload: { /* TODO */ } },
      undefined as any,
    );

    expect(view).toBeDefined();
    // Verify the view has sensible defaults
  });
});
```
