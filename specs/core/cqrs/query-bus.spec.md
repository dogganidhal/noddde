---
title: "QueryBus"
module: cqrs/query/query-bus
source_file: packages/core/src/cqrs/query/query-bus.ts
status: ready
exports: [QueryBus]
depends_on: [cqrs/query/query]
---

# QueryBus

> The `QueryBus` interface defines the contract for dispatching queries to their registered handlers and returning typed results. It is the primary interface for reading data from projections and read models, preserving the phantom `TResult` type through the dispatch call.

## Type Contract

- **`QueryBus`** is an interface with a single method:
  - `dispatch<TQuery extends Query<any>>(query: TQuery): Promise<QueryResult<TQuery>>` -- dispatches a query and returns its typed result.
- The method is generic over `TQuery`, preserving the concrete query type to extract the result.
- The return type uses `QueryResult<TQuery>` to resolve the phantom result type from the query.

## Behavioral Requirements

- `dispatch` is generic, unlike `CommandBus.dispatch`, because the return type depends on the query type.
- The generic parameter enables type inference: when you pass a `Query<UserView>`, the return type is `Promise<UserView>`.
- `dispatch` returns a `Promise`, meaning all query resolution is treated as asynchronous.
- The bus routes queries to the appropriate handler based on the query's `name`.

## Invariants

- The return type is always `Promise<QueryResult<TQuery>>`, which resolves to `Promise<T>` where `T` is the query's phantom result type.
- The generic constraint is `TQuery extends Query<any>`, accepting any query type.
- The method preserves the specific query type, not just the base `Query<any>`.

## Edge Cases

- **Query with `any` result**: Returns `Promise<any>`.
- **Query with `never` result**: Returns `Promise<never>`.
- **Base `Query<any>` dispatch**: Returns `Promise<any>` since `QueryResult<Query<any>>` is `any`.

## Integration Points

- `QueryBus` is a member of `CQRSInfrastructure`, making it available to standalone command handlers and saga event handlers.
- Projection query handlers are registered with the `QueryBus` implementation.
- The `QueryBus` is the read-side complement to `CommandBus` (write-side) and `EventBus` (event distribution).

## Test Scenarios

### QueryBus dispatch returns typed result

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { QueryBus, Query, DefineQueries, QueryResult } from "@noddde/core";

describe("QueryBus", () => {
  interface UserView {
    id: string;
    name: string;
  }

  type UserQuery = DefineQueries<{
    GetUserById: { payload: { id: string }; result: UserView };
    ListUsers: { result: UserView[] };
  }>;

  it("should return typed result for a specific query", () => {
    const bus = {} as QueryBus;
    type GetUserById = Extract<UserQuery, { name: "GetUserById" }>;
    const query = {} as GetUserById;
    expectTypeOf(bus.dispatch(query)).toEqualTypeOf<Promise<UserView>>();
  });

  it("should return array type for list queries", () => {
    const bus = {} as QueryBus;
    type ListUsers = Extract<UserQuery, { name: "ListUsers" }>;
    const query = {} as ListUsers;
    expectTypeOf(bus.dispatch(query)).toEqualTypeOf<Promise<UserView[]>>();
  });

  it("should return Promise<any> for base Query<any>", () => {
    const bus = {} as QueryBus;
    const query = {} as Query<any>;
    expectTypeOf(bus.dispatch(query)).toEqualTypeOf<Promise<any>>();
  });
});
```

### QueryBus preserves phantom type through dispatch

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { QueryBus, Query } from "@noddde/core";

describe("QueryBus phantom type preservation", () => {
  it("should infer the result type from the query", () => {
    const bus = {} as QueryBus;
    const query: Query<number> = { name: "GetCount" };
    const result = bus.dispatch(query);
    expectTypeOf(result).toEqualTypeOf<Promise<number>>();
  });
});
```
