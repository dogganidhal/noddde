---
title: "ProjectionTypes, Projection, defineProjection & Infer Utilities"
module: ddd/projection
source_file: packages/core/src/ddd/projection.ts
status: ready
exports: [ProjectionTypes, Projection, defineProjection, InferProjectionView, InferProjectionEvents, InferProjectionQueries, InferProjectionInfrastructure]
depends_on: [edd/event, cqrs/query/query, cqrs/query/query-handler, infrastructure/index]
---

# ProjectionTypes, Projection, defineProjection & Infer Utilities

> Projections are the read side of CQRS. They subscribe to domain events and maintain denormalized views tailored for specific query needs. `ProjectionTypes` bundles the four type parameters. `Projection` is the definition interface containing reducers (event-to-view transformers) and query handlers. `defineProjection` provides type inference. Four `Infer*` utilities extract individual types.

## Type Contract

- **`ProjectionTypes`** is a type with four required fields:
  - `events: Event` -- discriminated union of events this projection handles.
  - `queries: Query<any>` -- discriminated union of queries this projection answers.
  - `view: any` -- the read-optimized view model.
  - `infrastructure: Infrastructure` -- external dependencies for query handlers.

- **`ReducerMap<T>`** (internal) maps each event name to:
  - `(event: Extract<T["events"], { name: EventName }>, view: T["view"]) => Promise<T["view"]> | T["view"]`
  - Reducers receive the FULL event (not just payload), unlike `ApplyHandler`.

- **`QueryHandlerMap<T>`** (internal) maps each query name to an OPTIONAL `QueryHandler`:
  - `[QueryName]?: QueryHandler<T["infrastructure"], Extract<T["queries"], { name: QueryName }>>`

- **`Projection<T extends ProjectionTypes>`** is an interface with two fields:
  - `reducers: ReducerMap<T>` -- required handler for every event name.
  - `queryHandlers: QueryHandlerMap<T>` -- optional handler per query name.

- **`defineProjection<T>(config): Projection<T>`** -- identity function for type inference.

- **Infer utilities**:
  - `InferProjectionView<T extends Projection>` = inferred `U["view"]`.
  - `InferProjectionEvents<T extends Projection>` = inferred `U["events"]`.
  - `InferProjectionQueries<T extends Projection>` = inferred `U["queries"]`.
  - `InferProjectionInfrastructure<T extends Projection>` = inferred `U["infrastructure"]`.

## Behavioral Requirements

- Reducers receive the FULL event object (with narrowed type via `Extract`), not just the payload. This differs from `ApplyHandler` which receives only the payload. The reason is that projection reducers may need event metadata (like the `name` field) for routing or logging.
- Reducers may be sync or async (`T["view"] | Promise<T["view"]>`).
- Every event in the union MUST have a corresponding reducer (exhaustive).
- Query handlers are OPTIONAL per query name (the `?` modifier). A projection may handle events without directly serving queries.
- `defineProjection` is an identity function returning the same config object.

## Invariants

- The `reducers` map has exactly one key per event name in `T["events"]`.
- The `queryHandlers` map has at most one key per query name in `T["queries"]`; keys are optional.
- Reducer first parameter is the full event (with `name` and `payload`), not just `payload`.
- Reducer second parameter and return type are both `T["view"]`.
- Query handler types match `QueryHandler<T["infrastructure"], ...>`.
- `defineProjection` returns the exact same object reference.

## Edge Cases

- **Projection with no query handlers**: `queryHandlers: {}` is valid since all entries are optional.
- **Async reducers**: Returning `Promise<T["view"]>` is valid.
- **Single event projection**: The reducer map has one key.
- **View type is a primitive**: `view: number` is valid; reducers accept and return `number`.

## Integration Points

- The engine/runtime subscribes projections to the `EventBus` and invokes reducers when matching events arrive.
- Query handlers are registered with the `QueryBus` implementation.
- `InferProjection*` utilities are used downstream for type-safe view access and query building.
- Projections complement aggregates: aggregates handle the write side, projections handle the read side.

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
import type { DefineEvents, DefineQueries, Infrastructure, Query } from "@noddde/core";
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
          expectTypeOf(event).toEqualTypeOf<{ name: "ItemAdded"; payload: { item: string } }>();
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
  interface MyView { items: string[] }
  type MyEvent = DefineEvents<{ Added: { item: string } }>;
  type MyQuery = DefineQueries<{ GetItems: { result: string[] } }>;
  interface MyInfra extends Infrastructure { db: { query(): Promise<string[]> } }

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
    expectTypeOf<InferProjectionQueries<typeof proj>>().toEqualTypeOf<MyQuery>();
  });

  it("should infer infrastructure type", () => {
    expectTypeOf<InferProjectionInfrastructure<typeof proj>>().toEqualTypeOf<MyInfra>();
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
  type Def = { events: E; queries: Query<any>; view: number; infrastructure: Infrastructure };

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
