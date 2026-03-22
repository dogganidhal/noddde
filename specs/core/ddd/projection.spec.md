---
title: "ProjectionTypes, Projection, defineProjection & Infer Utilities"
module: ddd/projection
source_file: packages/core/src/ddd/projection.ts
status: implemented
exports:
  [
    ProjectionTypes,
    Projection,
    defineProjection,
    InferProjectionView,
    InferProjectionEvents,
    InferProjectionQueries,
    InferProjectionInfrastructure,
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

# ProjectionTypes, Projection, defineProjection & Infer Utilities

> Projections are the read side of CQRS. They subscribe to domain events and maintain denormalized views tailored for specific query needs. `ProjectionTypes` bundles the type parameters. `Projection` is the definition interface containing reducers (event-to-view transformers), query handlers, and optional view persistence configuration (`identity`, `viewStore`, `initialView`, `consistency`). `defineProjection` provides type inference. Four `Infer*` utilities extract individual types.

## Type Contract

- **`ProjectionTypes`** is a type with four required fields and one optional field:

  - `events: Event` -- discriminated union of events this projection handles.
  - `queries: Query<any>` -- discriminated union of queries this projection answers.
  - `view: any` -- the read-optimized view model.
  - `infrastructure: Infrastructure` -- external dependencies for query handlers.
  - `viewStore?: ViewStore` -- (optional) the typed view store for this projection. When present, enables typed `{ views }` injection into query handlers and auto-persistence.

- **`ReducerMap<T>`** (internal) maps each event name to:

  - `(event: Extract<T["events"], { name: EventName }>, view: T["view"]) => Promise<T["view"]> | T["view"]`
  - Reducers receive the FULL event (not just payload), unlike `ApplyHandler`.

- **`IdentityMap<T>`** (internal) maps each event name to a function that extracts the view instance ID:

  - `[K in T["events"]["name"]]: (event: Extract<T["events"], { name: K }>) => ID`
  - Mirrors `SagaAssociationMap` from `saga.ts`. Enables the engine to route events to the correct view instance for auto-persistence.

- **`ProjectionQueryInfra<T>`** (internal) conditionally injects the view store into query handler infrastructure:

  - When `T` has a `viewStore` field extending `ViewStore`: `T["infrastructure"] & { views: T["viewStore"] }`
  - When `T` does not have a `viewStore` field: `T["infrastructure"]`
  - This is backward compatible — existing projections without `viewStore` continue to work.

- **`ViewStoreFactory<T>`** (internal) is the factory type for resolving a view store from infrastructure:

  - When `T` has a `viewStore` field extending `ViewStore`: `(infrastructure: T["infrastructure"]) => T["viewStore"]`
  - When `T` does not have a `viewStore` field: `(infrastructure: T["infrastructure"]) => ViewStore<T["view"]>`
  - Synchronous only — the view store must be fully initialized before being provided via infrastructure.
  - Enables IoC: the projection definition (domain code) resolves the store from infrastructure rather than constructing it.

- **`QueryHandlerMap<T>`** (internal) maps each query name to an OPTIONAL `QueryHandler`, using `ProjectionQueryInfra<T>` as the infrastructure type:

  - `[QueryName]?: QueryHandler<ProjectionQueryInfra<T>, Extract<T["queries"], { name: QueryName }>>`

- **`Projection<T extends ProjectionTypes>`** is an interface with two required fields and four optional fields:

  - `reducers: ReducerMap<T>` -- required handler for every event name.
  - `queryHandlers: QueryHandlerMap<T>` -- optional handler per query name.
  - `initialView?: T["view"]` -- optional default view state for new view instances.
  - `identity?: IdentityMap<T>` -- optional map from event names to view instance ID extractors.
  - `viewStore?: ViewStoreFactory<T>` -- optional factory for creating the view store.
  - `consistency?: "eventual" | "strong"` -- optional consistency mode (defaults to `"eventual"`).

- **`defineProjection<T>(config): Projection<T>`** -- identity function for type inference.

- **Infer utilities**:
  - `InferProjectionView<T extends Projection>` = inferred `U["view"]`.
  - `InferProjectionEvents<T extends Projection>` = inferred `U["events"]`.
  - `InferProjectionQueries<T extends Projection>` = inferred `U["queries"]`.
  - `InferProjectionInfrastructure<T extends Projection>` = inferred `U["infrastructure"]`.

## Behavioral Requirements

1. Reducers receive the FULL event object (with narrowed type via `Extract`), not just the payload. This differs from `ApplyHandler` which receives only the payload. The reason is that projection reducers may need event metadata (like the `name` field) for routing or logging.
2. Reducers may be sync or async (`T["view"] | Promise<T["view"]>`).
3. Every event in the union MUST have a corresponding reducer (exhaustive).
4. Query handlers are OPTIONAL per query name (the `?` modifier). A projection may handle events without directly serving queries.
5. `defineProjection` is an identity function returning the same config object.
6. When `T` has a `viewStore` field, `QueryHandlerMap` uses `ProjectionQueryInfra<T>` which merges `{ views: T["viewStore"] }` into the infrastructure type. Query handlers can access `views.load()`, `views.save()`, and any custom methods on the view store.
7. When `T` does not have a `viewStore` field, `QueryHandlerMap` uses `T["infrastructure"]` as-is (backward compatible).
8. `identity` requires a mapping for ALL event names (exhaustive, TypeScript enforced). This mirrors saga `associations`. When present, the engine uses it to derive the view instance ID from each event for auto-persistence.
9. `viewStore` is a synchronous factory function `(infrastructure) => ViewStore`. It receives the resolved infrastructure and returns an already-initialized view store instance. The factory must not be async — infrastructure initialization belongs outside the projection definition.
10. `initialView` provides the default view state when `viewStore.load()` returns `undefined`/`null` for a new entity. Without it, reducers may receive `undefined` as the current view.
11. `consistency` defaults to `"eventual"`. When `"strong"`, the engine enlists view persistence in the same UoW as the originating command. When `"eventual"`, views are updated asynchronously via the event bus.
12. All fields (`identity`, `viewStore`, `initialView`, `consistency`) are optional at the type level. However, projections without `identity` and `viewStore` will not have their reducers subscribed to the event bus — they serve only as query handler containers.

## Invariants

- The `reducers` map has exactly one key per event name in `T["events"]`.
- The `queryHandlers` map has at most one key per query name in `T["queries"]`; keys are optional.
- Reducer first parameter is the full event (with `name` and `payload`), not just `payload`.
- Reducer second parameter and return type are both `T["view"]`.
- Query handler infrastructure type is `ProjectionQueryInfra<T>` -- conditionally includes `{ views }`.
- `defineProjection` returns the exact same object reference.
- `identity` map (when present) has exactly one key per event name in `T["events"]` (exhaustive).
- `identity` functions return `ID` (`string | number | bigint`).
- `viewStore` factory receives `T["infrastructure"]` and returns `ViewStore` (or a user-extended subtype).
- `consistency` is `"eventual"` or `"strong"` when specified; the engine defaults to `"eventual"` when omitted.

## Edge Cases

- **Projection with no query handlers**: `queryHandlers: {}` is valid since all entries are optional.
- **Async reducers**: Returning `Promise<T["view"]>` is valid.
- **Single event projection**: The reducer map has one key.
- **View type is a primitive**: `view: number` is valid; reducers accept and return `number`.
- **Projection without viewStore**: All fields (`identity`, `viewStore`, `initialView`, `consistency`) are optional at the type level. A projection without `identity` and `viewStore` will not have its reducers subscribed to the event bus — it serves only as a query handler container.
- **Projection with viewStore but no identity**: Valid — the engine does not auto-persist views, but query handlers still receive `{ views }`. Manual persistence by the user.
- **Projection with identity but no viewStore**: The engine MUST throw an error at init time. `identity` without `viewStore` is nonsensical (no store to persist to).
- **initialView is undefined**: Reducers may receive `undefined` as the current view when processing the first event for a new entity. The user is responsible for handling this in their reducer.
- **ViewStore factory is synchronous**: The factory must return the view store instance directly (not a Promise). Async initialization belongs in infrastructure setup.

## Integration Points

- The engine/runtime subscribes projections to the `EventBus` and invokes reducers when matching events arrive.
- Query handlers are registered with the `QueryBus` implementation.
- `InferProjection*` utilities are used downstream for type-safe view access and query building.
- Projections complement aggregates: aggregates handle the write side, projections handle the read side.
- When `identity` and `viewStore` are present, the engine auto-persists views: `event → identity → load → reduce → save`.
- When `viewStore` is present, query handlers receive `{ views: viewStoreInstance }` merged into their infrastructure.
- Strong consistency projections: view persistence is enlisted in the command's `UnitOfWork` via `onEventsProduced` callback.
- Eventual consistency projections: view persistence happens asynchronously via event bus subscription.

## Test Scenarios

### defineProjection with reducers and query handlers

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
    reducers: {
      AccountCreated: (event, _view) => ({
        id: event.payload.id,
        balance: 0,
      }),
      DepositMade: (event, view) => ({
        ...view,
        balance: view.balance + event.payload.amount,
      }),
    },
    queryHandlers: {
      GetAccountById: (payload, infra) => infra.accountRepo.getById(payload.id),
      ListAccounts: (_payload, infra) => infra.accountListRepo.getAll(),
    },
  });

  it("should have typed reducers", () => {
    expectTypeOf(projection.reducers.AccountCreated).toBeFunction();
    expectTypeOf(projection.reducers.DepositMade).toBeFunction();
  });

  it("should have typed query handlers", () => {
    expectTypeOf(projection.queryHandlers.GetAccountById).not.toBeUndefined();
  });
});
```

### Reducers receive the full event, not just payload

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  Query,
} from "@noddde/core";
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
      reducers: {
        ItemAdded: (event, view) => {
          // event has both name and payload
          expectTypeOf(event).toEqualTypeOf<{
            name: "ItemAdded";
            payload: { item: string };
          }>();
          expectTypeOf(event.name).toEqualTypeOf<"ItemAdded">();
          expectTypeOf(event.payload).toEqualTypeOf<{ item: string }>();
          return [...view, event.payload.item];
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
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
      },
      queryHandlers: {},
    });
    expect(projection.queryHandlers).toEqual({});
  });

  it("should compile with partial query handlers", () => {
    const projection = defineProjection<Def>({
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
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
    reducers: {
      Added: (event, view) => ({ items: [...view.items, event.payload.item] }),
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
      reducers: {
        ItemAdded: async (event, view) => {
          return [...view, event.payload.item];
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
      reducers: { X: (_event: any, _view: any) => 42 },
      queryHandlers: {},
    };
    const result = defineProjection<Def>(config as any);
    expect(result).toBe(config);
  });
});
```

### Projection with identity map

```ts
import { describe, it, expectTypeOf, expect } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  Infrastructure,
  ViewStore,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Projection with identity", () => {
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

  it("should accept identity map with exhaustive event mappings", () => {
    const projection = defineProjection<Def>({
      reducers: {
        AccountCreated: (event, _view) => ({
          id: event.payload.id,
          balance: 0,
        }),
        DepositMade: (event, view) => ({
          ...view,
          balance: view.balance + event.payload.amount,
        }),
      },
      identity: {
        AccountCreated: (event) => event.payload.id,
        DepositMade: (event) => event.payload.accountId,
      },
      viewStore: (_infra) => ({
        save: async () => {},
        load: async () => undefined,
        findByBalanceRange: async () => [],
      }),
      queryHandlers: {
        GetAccountById: (payload, { views }) => views.load(payload.id),
      },
    });

    expect(projection.identity).toBeDefined();
    expect(projection.identity!.AccountCreated).toBeTypeOf("function");
    expect(projection.identity!.DepositMade).toBeTypeOf("function");
  });
});
```

### Query handlers receive views when viewStore is defined

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
      reducers: {
        ItemCreated: (event, _view) => ({
          id: event.payload.id,
          name: event.payload.name,
        }),
      },
      identity: {
        ItemCreated: (event) => event.payload.id,
      },
      viewStore: (_infra) => ({
        save: async () => {},
        load: async () => undefined,
        findByName: async () => [],
      }),
      queryHandlers: {
        GetItem: (payload, infra) => {
          // infra should have views with typed ViewStore methods
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

describe("Backward compatible query handlers (no viewStore)", () => {
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
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
      },
      queryHandlers: {
        GetById: (payload, infra) => {
          // infra should NOT have views property
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
      reducers: {
        ItemAdded: (event, view) => [...view, event.payload.item],
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
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
      },
      identity: {
        Created: (event) => event.payload.id,
      },
      viewStore: (_infra) => ({
        save: async () => {},
        load: async () => undefined,
      }),
      queryHandlers: {},
      consistency: "eventual",
    });
    expect(projection.consistency).toBe("eventual");
  });

  it("should accept strong consistency", () => {
    const projection = defineProjection<Def>({
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
      },
      identity: {
        Created: (event) => event.payload.id,
      },
      viewStore: (_infra) => ({
        save: async () => {},
        load: async () => undefined,
      }),
      queryHandlers: {},
      consistency: "strong",
    });
    expect(projection.consistency).toBe("strong");
  });
});
```

### viewStore factory receives infrastructure

```ts
import { describe, it, expectTypeOf, expect } from "vitest";
import type {
  DefineEvents,
  Infrastructure,
  Query,
  ViewStore,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("viewStore factory", () => {
  interface MyInfra extends Infrastructure {
    db: { getConnection(): string };
  }

  type Events = DefineEvents<{ Created: { id: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string };
    infrastructure: MyInfra;
    viewStore: ViewStore<{ id: string }>;
  };

  it("should pass infrastructure to the viewStore factory", () => {
    let receivedInfra: MyInfra | undefined;

    const projection = defineProjection<Def>({
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
      },
      viewStore: (infra) => {
        receivedInfra = infra;
        expectTypeOf(infra).toEqualTypeOf<MyInfra>();
        return {
          save: async () => {},
          load: async () => undefined,
        };
      },
      queryHandlers: {},
    });

    expect(projection.viewStore).toBeTypeOf("function");
  });
});
```

### All view persistence fields are optional

```ts
import { describe, it, expect } from "vitest";
import type { DefineEvents, Infrastructure, Query } from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("Backward compatibility", () => {
  type Events = DefineEvents<{ Created: { id: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string };
    infrastructure: Infrastructure;
  };

  it("should work without any new fields", () => {
    const projection = defineProjection<Def>({
      reducers: {
        Created: (event, _view) => ({ id: event.payload.id }),
      },
      queryHandlers: {},
    });

    expect(projection.identity).toBeUndefined();
    expect(projection.viewStore).toBeUndefined();
    expect(projection.initialView).toBeUndefined();
    expect(projection.consistency).toBeUndefined();
  });
});
```
