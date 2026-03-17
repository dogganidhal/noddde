---
title: "QueryHandler"
module: cqrs/query/query-handler
source_file: packages/core/src/cqrs/query/query-handler.ts
status: ready
exports: [QueryHandler]
depends_on: [cqrs/query/query, infrastructure/index]
---

# QueryHandler

> `QueryHandler` is a function type that handles a query by reading from infrastructure and returning the expected result. It receives the query payload (not the full query object) and has access to infrastructure for data retrieval. The return type is automatically derived from the query's phantom result type.

## Type Contract

- **`QueryHandler<TInfrastructure, TQuery>`** is a function type:
  - First parameter: `query: TQuery["payload"]` -- the query payload (filters, IDs, etc.).
  - Second parameter: `infrastructure: TInfrastructure` -- external dependencies for data access.
  - Return type: `QueryResult<TQuery> | Promise<QueryResult<TQuery>>` -- sync or async, typed by the query's phantom result.
- `TInfrastructure` is constrained to `extends Infrastructure`.
- `TQuery` is constrained to `extends Query<any>`.

## Behavioral Requirements

- The handler receives the unwrapped `payload` from the query, not the full query object. This is consistent with `EventHandler` and `ApplyHandler` which also receive payloads.
- The return type is derived from the query's phantom `TResult` type via `QueryResult<TQuery>`.
- The handler may return synchronously or asynchronously (`T | Promise<T>`).
- Infrastructure provides access to repositories, caches, databases, etc.
- Unlike `StandaloneCommandHandler`, the infrastructure is NOT merged with `CQRSInfrastructure`.

## Invariants

- The first parameter type is `TQuery["payload"]`, which may be `any` (since `Query.payload` is `any`).
- The return type always matches `QueryResult<TQuery>` or its promise-wrapped form.
- The generic parameter order is `<TInfrastructure, TQuery>` (infrastructure first, query second).
- No `CQRSInfrastructure` merging -- query handlers are read-only by convention.

## Edge Cases

- **Query with no payload**: The first parameter becomes `any` (inherited from `Query.payload?: any`).
- **Query with `any` result**: Return type is `any | Promise<any>`.
- **Synchronous handler**: Returning the result directly (not in a Promise) is valid.
- **Empty infrastructure**: Handler still works with `Infrastructure` (which is `{}`).

## Integration Points

- `QueryHandler` is used in `QueryHandlerMap` inside the `Projection` interface, where handlers are registered per query name.
- `QueryHandler` return type aligns with `QueryBus.dispatch` return type via `QueryResult`.
- Projection `queryHandlers` are optional per query name (`[QueryName]?: QueryHandler<...>`).

## Test Scenarios

### QueryHandler receives payload and infrastructure, returns typed result

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { QueryHandler, DefineQueries, QueryResult, Infrastructure } from "@noddde/core";

describe("QueryHandler", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  interface AccountInfra extends Infrastructure {
    accountRepo: { getById(id: string): Promise<AccountView> };
  }

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView };
  }>;

  type GetAccountByIdQuery = Extract<AccountQuery, { name: "GetAccountById" }>;
  type Handler = QueryHandler<AccountInfra, GetAccountByIdQuery>;

  it("should receive query payload as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{ id: string }>();
  });

  it("should receive infrastructure as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<AccountInfra>();
  });

  it("should return the query result type or a promise of it", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      AccountView | Promise<AccountView>
    >();
  });
});
```

### QueryHandler allows sync and async implementations

```ts
import { describe, it, expect } from "vitest";
import type { QueryHandler, Query, Infrastructure } from "@noddde/core";

describe("QueryHandler sync/async", () => {
  it("should allow synchronous handler", () => {
    const handler: QueryHandler<Infrastructure, Query<number>> = (_payload) => {
      return 42;
    };
    expect(handler({}, {})).toBe(42);
  });

  it("should allow asynchronous handler", () => {
    const handler: QueryHandler<Infrastructure, Query<number>> = async (_payload) => {
      return 42;
    };
    expect(handler({}, {})).resolves.toBe(42);
  });
});
```

### QueryHandler does not receive CQRSInfrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { QueryHandler, Query, Infrastructure, CQRSInfrastructure } from "@noddde/core";

describe("QueryHandler infrastructure isolation", () => {
  type Handler = QueryHandler<Infrastructure, Query<string>>;

  it("should not have commandBus in infrastructure", () => {
    expectTypeOf<Parameters<Handler>[1]>().not.toMatchTypeOf<CQRSInfrastructure>();
  });
});
```
