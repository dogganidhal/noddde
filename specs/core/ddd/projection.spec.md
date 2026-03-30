---
title: "ProjectionTypes, Projection, ProjectionEventHandler, defineProjection & Infer Utilities"
module: ddd/projection
source_file: packages/core/src/ddd/projection.ts
status: implemented
exports:
  [
    ProjectionTypes,
    ProjectionEventHandler,
    Projection,
    defineProjection,
    InferProjectionView,
    InferProjectionEvents,
    InferProjectionQueries,
    InferProjectionInfrastructure,
    InferProjectionEventHandler,
    InferProjectionQueryHandler,
    InferProjectionQueryInfrastructure,
  ]
depends_on:
  [
    edd/event,
    cqrs/query/query,
    cqrs/query/query-handler,
    infrastructure/index,
    persistence/view-store,
  ]
docs:
  - projections/overview.mdx
  - projections/functional-projections.mdx
  - projections/connecting-events.mdx
  - projections/view-persistence.mdx
---

# ProjectionTypes, Projection, ProjectionEventHandler, defineProjection & Infer Utilities

> Projections are the read side of CQRS. They subscribe to domain events and maintain denormalized views tailored for specific query needs. The `on` map defines which events a projection handles — each entry bundles an identity extractor (`id`) and a reducer (`reduce`). Only events the projection cares about need entries; unhandled events are silently ignored. `viewStore` configuration has moved to the domain runtime wiring (engine); projections remain pure domain definitions. `defineProjection` provides type inference. Four `Infer*` utilities extract individual types.

## Type Contract

- **`ProjectionTypes`** is a type with four required fields and one optional field:

  - `events: Event` -- discriminated union of events this projection handles.
  - `queries: Query<any>` -- discriminated union of queries this projection answers.
  - `view: any` -- the read-optimized view model.
  - `infrastructure: Infrastructure` -- external dependencies for query handlers.
  - `viewStore?: ViewStore` -- (optional) type-level hint for the view store. When present, enables typed `{ views }` injection into query handlers via `ProjectionQueryInfra<T>`. Not used at runtime in the projection definition — the actual view store is provided in the domain configuration.

- **`ProjectionEventHandler<TEvent, TView>`** (exported) bundles the identity extractor and reducer for one event type:

  - `id?: (event: TEvent) => ID` -- extracts the view instance ID from the event. Optional per-entry. Required by the engine when a view store is configured for auto-persistence.
  - `reduce: (event: TEvent, view: TView) => TView | Promise<TView>` -- transforms the current view based on the event. Receives the full event object (not just payload). May be sync or async.

- **`ProjectionOnMap<T>`** (internal) maps event names to their handlers. This map is **partial** — only events the projection cares about need entries:

  - `[K in T["events"]["name"]]?: ProjectionEventHandler<Extract<T["events"], { name: K }>, T["view"]>`
  - Keys are constrained to valid event names (typos caught at compile time).
  - Unhandled events are silently ignored at runtime.

- **`ProjectionQueryInfra<T>`** (internal) conditionally injects the view store into query handler infrastructure:

  - When `T` has a `viewStore` field extending `ViewStore`: `T["infrastructure"] & { views: T["viewStore"] }`
  - When `T` does not have a `viewStore` field: `T["infrastructure"]`

- **`QueryHandlerMap<T>`** (internal) maps each query name to an OPTIONAL `QueryHandler`, using `ProjectionQueryInfra<T>` as the infrastructure type:

  - `[QueryName]?: QueryHandler<ProjectionQueryInfra<T>, Extract<T["queries"], { name: QueryName }>>`

- **`Projection<T extends ProjectionTypes>`** is an interface with two required fields and three optional fields:

  - `on: ProjectionOnMap<T>` -- partial map of event handlers. Each entry bundles an `id` function (extracts view instance ID) and a `reduce` function (transforms the view). Only events the projection cares about need entries.
  - `queryHandlers: QueryHandlerMap<T>` -- optional handler per query name.
  - `initialView?: T["view"]` -- optional default view state for new view instances.
  - `viewStore?: ViewStoreFactory<T>` -- optional factory function that resolves a view store from infrastructure. When `T` has a typed `viewStore` field, returns that specific type; otherwise returns `ViewStore<T["view"]>`. Prefer using `ProjectionWiring` in `DomainWiring` for runtime view store configuration.
  - `consistency?: "eventual" | "strong"` -- optional consistency mode (defaults to `"eventual"`).

- **`defineProjection<T>(config): Projection<T>`** -- identity function for type inference.

- **Infer utilities** (operate on `Projection` definition instances):

  - `InferProjectionView<T extends Projection>` = inferred `U["view"]`.
  - `InferProjectionEvents<T extends Projection>` = inferred `U["events"]`.
  - `InferProjectionQueries<T extends Projection>` = inferred `U["queries"]`.
  - `InferProjectionInfrastructure<T extends Projection>` = inferred `U["infrastructure"]`.

- **Handler-level inference utilities** (operate on `ProjectionTypes` bundle, for typing extracted handlers in separate files):

  - `InferProjectionEventHandler<T extends ProjectionTypes, K extends T["events"]["name"]>` = `ProjectionEventHandler<Extract<T["events"], { name: K }>, T["view"]>`. Resolves to the `{ id?, reduce }` bundle for event `K`, with the event narrowed via `Extract`.

  - `InferProjectionQueryInfrastructure<T extends ProjectionTypes>` = conditionally `T["infrastructure"] & { views: T["viewStore"] }` when `T` has a `viewStore` field extending `ViewStore`, otherwise `T["infrastructure"]`. This is the public export of the internal `ProjectionQueryInfra<T>` logic.

  - `InferProjectionQueryHandler<T extends ProjectionTypes, K extends T["queries"]["name"]>` = `QueryHandler<InferProjectionQueryInfrastructure<T>, Extract<T["queries"], { name: K }>>`. Resolves to the exact query handler function type for query `K`, with views injection when applicable.

## Behavioral Requirements

1. Reducers receive the FULL event object (with narrowed type via `Extract`), not just the payload. This differs from `ApplyHandler` which receives only the payload.
2. Reducers may be sync or async (`T["view"] | Promise<T["view"]>`).
3. The `on` map is **partial** over the event union — only events the projection cares about need entries. Unhandled events are silently ignored. This replaces the old exhaustive `reducers` map.
4. Query handlers are OPTIONAL per query name (the `?` modifier). A projection may handle events without directly serving queries.
5. `defineProjection` is an identity function returning the same config object.
6. When `T` has a `viewStore` field, `QueryHandlerMap` uses `ProjectionQueryInfra<T>` which merges `{ views: T["viewStore"] }` into the infrastructure type. Query handlers can access `views.load()`, `views.save()`, and any custom methods on the view store.
7. When `T` does not have a `viewStore` field, `QueryHandlerMap` uses `T["infrastructure"]` as-is.
8. The `id` function within each `on` entry is optional at the type level. When a view store is configured in the domain runtime, the engine validates that every `on` entry has an `id` function.
9. `initialView` provides the default view state when the view store returns `undefined`/`null` for a new entity. Without it, reducers may receive `undefined` as the current view.
10. `consistency` defaults to `"eventual"`. When `"strong"`, the engine enlists view persistence in the same UoW as the originating command. When `"eventual"`, views are updated asynchronously via the event bus.
11. `ProjectionEventHandler` is exported so users can reference it in utility types and generic helpers.
12. `InferProjectionEventHandler<T, K>` resolves to a `{ id?, reduce }` object type with the event narrowed to variant `K` and the view type from `T`.
13. `InferProjectionQueryInfrastructure<T>` conditionally injects `{ views: T["viewStore"] }` into `T["infrastructure"]` when `T` has a `viewStore` field, matching the internal `ProjectionQueryInfra<T>` logic.
14. `InferProjectionQueryHandler<T, K>` resolves to a query handler function receiving the narrowed query payload and the conditional infrastructure (with or without `{ views }`).
15. All three handler-level inference utilities operate on the `ProjectionTypes` bundle (not the `Projection` definition instance), enabling use before `defineProjection` is called.

## Invariants

- The `on` map has at most one key per event name in `T["events"]`; keys are optional.
- The `queryHandlers` map has at most one key per query name in `T["queries"]`; keys are optional.
- Reducer first parameter is the full event (with `name` and `payload`), not just `payload`.
- Reducer second parameter and return type are both `T["view"]`.
- Query handler infrastructure type is `ProjectionQueryInfra<T>` -- conditionally includes `{ views }`.
- `defineProjection` returns the exact same object reference.
- `id` functions (when present) return `ID` (`string | number | bigint`).
- `consistency` is `"eventual"` or `"strong"` when specified; the engine defaults to `"eventual"` when omitted.
- `on` map keys are constrained to `T["events"]["name"]` — invalid event names are compile errors.
- `InferProjectionEventHandler<T, K>` always produces the same type as `ProjectionOnMap<T>[K]`.
- `InferProjectionQueryHandler<T, K>` always produces the same type as `QueryHandlerMap<T>[K]`.
- `InferProjectionQueryInfrastructure<T>` always produces the same type as internal `ProjectionQueryInfra<T>`.

## Edge Cases

- **Projection with no query handlers**: `queryHandlers: {}` is valid since all entries are optional.
- **Async reducers**: Returning `Promise<T["view"]>` is valid.
- **Single event projection**: The `on` map has one key.
- **View type is a primitive**: `view: number` is valid; reducers accept and return `number`.
- **Empty on map**: `on: {}` is valid — the projection serves only as a query handler container.
- **Partial on map**: A projection listening to 1 out of 8 events only has 1 entry in `on`. The other 7 are silently ignored.
- **on entry without id**: Valid at the type level. The engine validates that `id` is present when a view store is configured.
- **initialView is undefined**: Reducers may receive `undefined` as the current view when processing the first event for a new entity.
- **Projection with viewStore type hint but no id on entries**: Valid at the type level. Query handlers still receive `{ views }` typing. The engine validates `id` presence at init.

## Integration Points

- The engine/runtime subscribes projections to the `EventBus` for events listed in the `on` map.
- Query handlers are registered with the `QueryBus` implementation.
- `InferProjection*` utilities are used downstream for type-safe view access and query building.
- Projections complement aggregates: aggregates handle the write side, projections handle the read side.
- View store configuration lives in the domain runtime (`DomainWiring.projections` via `wireDomain`), not in the projection definition.
- When a view store is configured for a projection and `on` entries have `id`, the engine auto-persists views: `event → id → load → reduce → save`.
- When `T` has a `viewStore` type hint, query handlers receive `{ views: viewStoreInstance }` merged into their infrastructure.
- Strong consistency projections: view persistence is enlisted in the command's `UnitOfWork` via `onEventsProduced` callback.
- Eventual consistency projections: view persistence happens asynchronously via event bus subscription.

## Test Scenarios

### defineProjection with on map and query handlers

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents, DefineQueries, Infrastructure } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("defineProjection", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  type AccountEvent = DefineEvents<{
    AccountCreated: { id: string; owner: string };
    DepositMade: { amount: number };
  }>;

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView };
    ListAccounts: { result: AccountView[] };
  }>;

  interface AccountInfra extends Infrastructure {
    accountRepo: { getById(id: string): Promise<AccountView> };
    accountListRepo: { getAll(): Promise<AccountView[]> };
  }

  type AccountProjectionDef = {
    events: AccountEvent;
    queries: AccountQuery;
    view: AccountView;
    infrastructure: AccountInfra;
  };

  const projection = defineProjection<AccountProjectionDef>({
    on: {
      AccountCreated: {
        reduce: (event, _view) => ({
          id: event.payload.id,
          balance: 0,
        }),
      },
      DepositMade: {
        reduce: (event, view) => ({
          ...view,
          balance: view.balance + event.payload.amount,
        }),
      },
    },
    queryHandlers: {
      GetAccountById: (payload, infra) => infra.accountRepo.getById(payload.id),
      ListAccounts: (_payload, infra) => infra.accountListRepo.getAll(),
    },
  });

  it("should have typed on map entries", () => {
    expectTypeOf(projection.on.AccountCreated!.reduce).toBeFunction();
    expectTypeOf(projection.on.DepositMade!.reduce).toBeFunction();
  });

  it("should have typed query handlers", () => {
    expectTypeOf(projection.queryHandlers.GetAccountById).not.toBeUndefined();
  });
});
```

### Reducers receive the full event, not just payload

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Reducer event parameter", () => {
  type MyEvent = DefineEvents<{ ItemAdded: { item: string } }>;

  type Def = {
    events: MyEvent;
    queries: Query<any>;
    view: string[];
    infrastructure: Infrastructure;
  };

  it("should pass the full event to reducer, not just payload", () => {
    const projection = defineProjection<Def>({
      on: {
        ItemAdded: {
          reduce: (event, view) => {
            expectTypeOf(event).toEqualTypeOf<{
              name: "ItemAdded";
              payload: { item: string };
            }>();
            expectTypeOf(event.name).toEqualTypeOf<"ItemAdded">();
            expectTypeOf(event.payload).toEqualTypeOf<{ item: string }>();
            return [...view, event.payload.item];
          },
        },
      },
      queryHandlers: {},
    });
    expectTypeOf(projection).toMatchTypeOf<object>();
  });
});
```

### Query handlers are optional

```ts
import { describe, it, expect } from "vitest";
import type { DefineEvents, DefineQueries, Infrastructure } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Optional query handlers", () => {
  type Events = DefineEvents<{ Created: { id: string } }>;
  type Queries = DefineQueries<{
    GetById: { payload: { id: string }; result: { id: string } };
    ListAll: { result: { id: string }[] };
  }>;

  type Def = {
    events: Events;
    queries: Queries;
    view: { id: string };
    infrastructure: Infrastructure;
  };

  it("should compile with empty query handlers", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {},
    });
    expect(projection.queryHandlers).toEqual({});
  });

  it("should compile with partial query handlers", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {
        GetById: (payload, _infra) => ({ id: payload.id }),
      },
    });
    expect(projection.queryHandlers.GetById).toBeDefined();
  });
});
```

### Infer utilities extract types from projection

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  InferProjectionView,
  InferProjectionEvents,
  InferProjectionQueries,
  InferProjectionInfrastructure,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Projection Infer utilities", () => {
  interface MyView {
    items: string[];
  }
  type MyEvent = DefineEvents<{ Added: { item: string } }>;
  type MyQuery = DefineQueries<{ GetItems: { result: string[] } }>;
  interface MyInfra extends Infrastructure {
    db: { query(): Promise<string[]> };
  }

  type Def = {
    events: MyEvent;
    queries: MyQuery;
    view: MyView;
    infrastructure: MyInfra;
  };

  const proj = defineProjection<Def>({
    on: {
      Added: {
        reduce: (event, view) => ({
          items: [...view.items, event.payload.item],
        }),
      },
    },
    queryHandlers: {},
  });

  it("should infer view type", () => {
    expectTypeOf<InferProjectionView<typeof proj>>().toEqualTypeOf<MyView>();
  });

  it("should infer events type", () => {
    expectTypeOf<InferProjectionEvents<typeof proj>>().toEqualTypeOf<MyEvent>();
  });

  it("should infer queries type", () => {
    expectTypeOf<
      InferProjectionQueries<typeof proj>
    >().toEqualTypeOf<MyQuery>();
  });

  it("should infer infrastructure type", () => {
    expectTypeOf<
      InferProjectionInfrastructure<typeof proj>
    >().toEqualTypeOf<MyInfra>();
  });
});
```

### Async reducers are valid

```ts
import { describe, it, expect } from "vitest";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Async reducers", () => {
  type Events = DefineEvents<{ ItemAdded: { item: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: string[];
    infrastructure: Infrastructure;
  };

  it("should accept async reducer functions", () => {
    const proj = defineProjection<Def>({
      on: {
        ItemAdded: {
          reduce: async (event, view) => {
            return [...view, event.payload.item];
          },
        },
      },
      queryHandlers: {},
    });
    expect(proj).toBeDefined();
  });
});
```

### defineProjection is an identity function at runtime

```ts
import { describe, it, expect } from "vitest";
import { defineProjection } from "@noddde/core";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";

describe("defineProjection identity", () => {
  type E = DefineEvents<{ X: { v: number } }>;
  type Def = {
    events: E;
    queries: Query<any>;
    view: number;
    infrastructure: Infrastructure;
  };

  it("should return the exact same config object", () => {
    const config = {
      on: { X: { reduce: (_event: any, _view: any) => 42 } },
      queryHandlers: {},
    };
    const result = defineProjection<Def>(config as any);
    expect(result).toBe(config);
  });
});
```

### Projection with id in on entries

```ts
import { describe, it, expectTypeOf, expect } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  ViewStore,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Projection with id in on entries", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  type AccountEvent = DefineEvents<{
    AccountCreated: { id: string; owner: string };
    DepositMade: { accountId: string; amount: number };
  }>;

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView | null };
  }>;

  interface AccountViewStore extends ViewStore<AccountView> {
    findByBalanceRange(min: number, max: number): Promise<AccountView[]>;
  }

  type Def = {
    events: AccountEvent;
    queries: AccountQuery;
    view: AccountView;
    infrastructure: Infrastructure;
    viewStore: AccountViewStore;
  };

  it("should accept id functions in on entries", () => {
    const projection = defineProjection<Def>({
      on: {
        AccountCreated: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({
            id: event.payload.id,
            balance: 0,
          }),
        },
        DepositMade: {
          id: (event) => event.payload.accountId,
          reduce: (event, view) => ({
            ...view,
            balance: view.balance + event.payload.amount,
          }),
        },
      },
      queryHandlers: {
        GetAccountById: (payload, { views }) => views.load(payload.id),
      },
    });

    expect(projection.on.AccountCreated!.id).toBeTypeOf("function");
    expect(projection.on.DepositMade!.id).toBeTypeOf("function");
  });
});
```

### Query handlers receive views when viewStore type is defined

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  ViewStore,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Query handlers with views injection", () => {
  interface ItemView {
    id: string;
    name: string;
  }

  interface ItemViewStore extends ViewStore<ItemView> {
    findByName(name: string): Promise<ItemView[]>;
  }

  type ItemEvent = DefineEvents<{ ItemCreated: { id: string; name: string } }>;
  type ItemQuery = DefineQueries<{
    GetItem: { payload: { id: string }; result: ItemView | null };
    FindByName: { payload: { name: string }; result: ItemView[] };
  }>;

  type Def = {
    events: ItemEvent;
    queries: ItemQuery;
    view: ItemView;
    infrastructure: Infrastructure;
    viewStore: ItemViewStore;
  };

  it("should inject typed views into query handler infrastructure", () => {
    const projection = defineProjection<Def>({
      on: {
        ItemCreated: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({
            id: event.payload.id,
            name: event.payload.name,
          }),
        },
      },
      queryHandlers: {
        GetItem: (payload, infra) => {
          expectTypeOf(infra.views).toMatchTypeOf<ItemViewStore>();
          return infra.views.load(payload.id);
        },
        FindByName: (payload, infra) => {
          return infra.views.findByName(payload.name);
        },
      },
    });

    expectTypeOf(projection).toMatchTypeOf<object>();
  });
});
```

### Projection without viewStore has no views in query handler infra

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents, DefineQueries, Infrastructure } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Query handlers without viewStore (no views)", () => {
  interface MyInfra extends Infrastructure {
    repo: { getById(id: string): Promise<{ id: string }> };
  }

  type Events = DefineEvents<{ Created: { id: string } }>;
  type Queries = DefineQueries<{
    GetById: { payload: { id: string }; result: { id: string } };
  }>;

  type Def = {
    events: Events;
    queries: Queries;
    view: { id: string };
    infrastructure: MyInfra;
  };

  it("should use plain infrastructure without views", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {
        GetById: (payload, infra) => {
          expectTypeOf(infra).toEqualTypeOf<MyInfra>();
          return infra.repo.getById(payload.id);
        },
      },
    });

    expectTypeOf(projection).toMatchTypeOf<object>();
  });
});
```

### Projection with initialView

```ts
import { describe, it, expect } from "vitest";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Projection with initialView", () => {
  type Events = DefineEvents<{ ItemAdded: { item: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: string[];
    infrastructure: Infrastructure;
  };

  it("should accept initialView field", () => {
    const projection = defineProjection<Def>({
      on: {
        ItemAdded: {
          reduce: (event, view) => [...view, event.payload.item],
        },
      },
      queryHandlers: {},
      initialView: [],
    });

    expect(projection.initialView).toEqual([]);
  });
});
```

### Projection with consistency mode

```ts
import { describe, it, expect } from "vitest";
import type {
  DefineEvents,
  Infrastructure,
  Query,
  ViewStore,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Projection consistency mode", () => {
  type Events = DefineEvents<{ Created: { id: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string };
    infrastructure: Infrastructure;
    viewStore: ViewStore<{ id: string }>;
  };

  it("should accept eventual consistency", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {},
      consistency: "eventual",
    });
    expect(projection.consistency).toBe("eventual");
  });

  it("should accept strong consistency", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {},
      consistency: "strong",
    });
    expect(projection.consistency).toBe("strong");
  });
});
```

### Partial on map — only handle events you care about

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Partial on map", () => {
  type Events = DefineEvents<{
    Created: { id: string };
    Updated: { id: string; name: string };
    Deleted: { id: string };
    Archived: { id: string };
  }>;

  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string; name: string };
    infrastructure: Infrastructure;
  };

  it("should compile with only a subset of events in on map", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id, name: "" }),
        },
        Updated: {
          reduce: (event, view) => ({ ...view, name: event.payload.name }),
        },
        // Deleted and Archived intentionally omitted
      },
      queryHandlers: {},
    });

    expect(projection.on.Created).toBeDefined();
    expect(projection.on.Updated).toBeDefined();
    expect(projection.on.Deleted).toBeUndefined();
    expect(projection.on.Archived).toBeUndefined();
  });

  it("should compile with empty on map", () => {
    const projection = defineProjection<Def>({
      on: {},
      queryHandlers: {},
    });
    expect(Object.keys(projection.on)).toHaveLength(0);
  });
});
```

### id is optional per on entry

```ts
import { describe, it, expect } from "vitest";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Optional id in on entries", () => {
  type Events = DefineEvents<{
    Created: { id: string };
    Updated: { id: string; name: string };
  }>;

  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string; name: string };
    infrastructure: Infrastructure;
  };

  it("should compile with id on some entries but not others", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({ id: event.payload.id, name: "" }),
        },
        Updated: {
          // no id — valid at type level
          reduce: (event, view) => ({ ...view, name: event.payload.name }),
        },
      },
      queryHandlers: {},
    });

    expect(projection.on.Created!.id).toBeTypeOf("function");
    expect(projection.on.Updated!.id).toBeUndefined();
  });

  it("should compile with no id on any entry", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id, name: "" }),
        },
      },
      queryHandlers: {},
    });

    expect(projection.on.Created!.id).toBeUndefined();
  });
});
```

### InferProjectionEventHandler narrows event for reducer

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  Infrastructure,
  Query,
  InferProjectionEventHandler,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("InferProjectionEventHandler", () => {
  interface ItemView {
    id: string;
    name: string;
  }

  type ItemEvent = DefineEvents<{
    ItemCreated: { id: string; name: string };
    ItemUpdated: { id: string; newName: string };
  }>;

  type Def = {
    events: ItemEvent;
    queries: Query<any>;
    view: ItemView;
    infrastructure: Infrastructure;
  };

  it("should narrow the event to the specific variant in reduce", () => {
    type Handler = InferProjectionEventHandler<Def, "ItemCreated">;
    type ReduceParams = Parameters<Handler["reduce"]>;
    expectTypeOf<ReduceParams[0]>().toEqualTypeOf<
      Extract<ItemEvent, { name: "ItemCreated" }>
    >();
    expectTypeOf<ReduceParams[1]>().toEqualTypeOf<ItemView>();
  });

  it("should have optional id function with narrowed event", () => {
    type Handler = InferProjectionEventHandler<Def, "ItemCreated">;
    // id is optional
    expectTypeOf<Handler["id"]>().toEqualTypeOf<
      | ((
          event: Extract<ItemEvent, { name: "ItemCreated" }>,
        ) => string | number | bigint)
      | undefined
    >();
  });

  it("should be usable in defineProjection on map", () => {
    const onItemCreated: InferProjectionEventHandler<Def, "ItemCreated"> = {
      id: (event) => event.payload.id,
      reduce: (event, _view) => ({
        id: event.payload.id,
        name: event.payload.name,
      }),
    };

    const projection = defineProjection<Def>({
      on: {
        ItemCreated: onItemCreated,
      },
      queryHandlers: {},
    });

    expectTypeOf(projection.on.ItemCreated).not.toBeUndefined();
  });
});
```

### InferProjectionQueryHandler wires views when viewStore present

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  ViewStore,
  InferProjectionQueryHandler,
  FrameworkInfrastructure,
} from "@noddde/core";

describe("InferProjectionQueryHandler", () => {
  interface ItemView {
    id: string;
    name: string;
  }

  interface ItemViewStore extends ViewStore<ItemView> {
    findByName(name: string): Promise<ItemView[]>;
  }

  type ItemEvent = DefineEvents<{ ItemCreated: { id: string; name: string } }>;

  type ItemQuery = DefineQueries<{
    GetItem: { payload: { id: string }; result: ItemView | null };
    FindByName: { payload: { name: string }; result: ItemView[] };
  }>;

  type DefWithViewStore = {
    events: ItemEvent;
    queries: ItemQuery;
    view: ItemView;
    infrastructure: Infrastructure;
    viewStore: ItemViewStore;
  };

  type DefWithoutViewStore = {
    events: ItemEvent;
    queries: ItemQuery;
    view: ItemView;
    infrastructure: Infrastructure;
  };

  it("should include views in infrastructure when viewStore is defined", () => {
    type Handler = InferProjectionQueryHandler<DefWithViewStore, "GetItem">;
    type InfraParam = Parameters<Handler>[1];
    expectTypeOf<InfraParam>().toEqualTypeOf<
      Infrastructure & { views: ItemViewStore } & FrameworkInfrastructure
    >();
  });

  it("should use plain infrastructure when viewStore is absent", () => {
    type Handler = InferProjectionQueryHandler<DefWithoutViewStore, "GetItem">;
    type InfraParam = Parameters<Handler>[1];
    expectTypeOf<InfraParam>().toEqualTypeOf<
      Infrastructure & FrameworkInfrastructure
    >();
  });

  it("should narrow the query payload", () => {
    type Handler = InferProjectionQueryHandler<DefWithViewStore, "GetItem">;
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{ id: string }>();
  });

  it("should return the query result type", () => {
    type Handler = InferProjectionQueryHandler<DefWithViewStore, "GetItem">;
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      (ItemView | null) | Promise<ItemView | null>
    >();
  });
});
```

### InferProjectionQueryInfrastructure conditional type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  ViewStore,
  InferProjectionQueryInfrastructure,
  Query,
} from "@noddde/core";

describe("InferProjectionQueryInfrastructure", () => {
  interface MyView {
    id: string;
  }

  interface MyViewStore extends ViewStore<MyView> {
    custom(): Promise<MyView[]>;
  }

  interface MyInfra extends Infrastructure {
    db: { query(): Promise<MyView[]> };
  }

  type WithViewStore = {
    events: DefineEvents<{ Created: { id: string } }>;
    queries: Query<any>;
    view: MyView;
    infrastructure: MyInfra;
    viewStore: MyViewStore;
  };

  type WithoutViewStore = {
    events: DefineEvents<{ Created: { id: string } }>;
    queries: Query<any>;
    view: MyView;
    infrastructure: MyInfra;
  };

  it("should include views when viewStore is present", () => {
    expectTypeOf<
      InferProjectionQueryInfrastructure<WithViewStore>
    >().toEqualTypeOf<MyInfra & { views: MyViewStore }>();
  });

  it("should be plain infrastructure when viewStore is absent", () => {
    expectTypeOf<
      InferProjectionQueryInfrastructure<WithoutViewStore>
    >().toEqualTypeOf<MyInfra>();
  });
});
```
