---
title: "Query, QueryResult & DefineQueries"
module: cqrs/query/query
source_file: packages/core/src/cqrs/query/query.ts
status: ready
exports: [Query, QueryResult, DefineQueries]
depends_on: []
---

# Query, QueryResult & DefineQueries

> The `Query` interface is the base contract for all read-model queries. It carries a phantom `TResult` type parameter that encodes the expected return type at the type level without storing it in a field. `QueryResult` extracts this phantom type, and `DefineQueries` builds discriminated query unions from a definition map.

## Type Contract

- **`Query<TResult, TQueryNames>`** is an interface with:
  - `name: TQueryNames` -- discriminant field (defaults to `string`, also accepts `symbol`).
  - `payload?: any` -- optional query parameters.
  - `TResult` is a phantom type parameter -- it exists only in the type system and is not present as a field.
- **`QueryResult<TQuery>`** is a conditional type:
  - Extracts `TResult` from `TQuery extends Query<infer TResult>`.
  - Returns `never` if `TQuery` does not extend `Query<any>`.
- **`DefineQueries<TDefinitions>`** accepts a record where each value has `{ payload?: any; result: any }`:
  - For entries with a non-void `payload`, produces `{ name: K; payload: P } & Query<TResult, K>`.
  - For entries without `payload` or with `void` payload, produces `{ name: K } & Query<TResult, K>`.
  - The intersection with `Query<TResult, K>` embeds the phantom result type.

## Behavioral Requirements

- `Query` is a structural interface; any `{ name: string }` satisfies `Query<any>`.
- The phantom `TResult` type is invisible at runtime but extractable via `QueryResult`.
- `DefineQueries` uses conditional types to distinguish between queries with and without payloads.
- The `name` field in `DefineQueries` output is a string literal type, enabling exhaustive switching.
- `QueryResult` works on any type that extends `Query<any>`, including `DefineQueries` union members.

## Invariants

- `QueryResult<Query<T>>` always equals `T` for any `T`.
- Every member of a `DefineQueries` union extends `Query<SomeResult, SomeName>`.
- Members without payload in the definition do not have a `payload` field in the intersected explicit part (though they inherit `payload?: any` from `Query`).
- `DefineQueries<{}>` produces `never`.
- The `name` constraint `TQueryNames extends string | symbol` allows symbol-based names, though string is the default and typical usage.

## Edge Cases

- **Query with no payload**: `DefineQueries<{ ListAll: { result: Item[] } }>` produces a member with only `name` (plus the Query intersection).
- **Query with `void` payload**: `DefineQueries<{ ListAll: { payload: void; result: Item[] } }>` also omits `payload` from the explicit part.
- **Empty definitions**: `DefineQueries<{}>` produces `never`.
- **Phantom type extraction**: `QueryResult` works through intersection types because `{ name: K } & Query<R, K>` still extends `Query<R>`.
- **`any` result type**: `QueryResult<Query<any>>` is `any`.

## Integration Points

- `Query` is the base constraint for `QueryBus.dispatch`, `QueryHandler`, and `ProjectionTypes["queries"]`.
- `QueryResult` is used by `QueryBus.dispatch` return type and `QueryHandler` return type to enforce type-safe query responses.
- `DefineQueries` is the primary way users define their query unions, which flow into `ProjectionTypes`.

## Test Scenarios

### Query interface with phantom result type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Query, QueryResult } from "@noddde/core";

describe("Query", () => {
  it("should accept a basic query object", () => {
    const query: Query<string[]> = { name: "ListUsers" };
    expectTypeOf(query.name).toBeString();
  });

  it("should accept query with payload", () => {
    const query: Query<{ id: string; name: string }> = {
      name: "GetUserById",
      payload: { id: "123" },
    };
    expectTypeOf(query).toMatchTypeOf<Query<any>>();
  });
});
```

### QueryResult extracts phantom type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Query, QueryResult } from "@noddde/core";

describe("QueryResult", () => {
  it("should extract the result type from Query", () => {
    type UserListQuery = Query<string[]>;
    expectTypeOf<QueryResult<UserListQuery>>().toEqualTypeOf<string[]>();
  });

  it("should work with complex result types", () => {
    interface UserView {
      id: string;
      name: string;
      email: string;
    }
    type GetUserQuery = Query<UserView>;
    expectTypeOf<QueryResult<GetUserQuery>>().toEqualTypeOf<UserView>();
  });

  it("should return any for Query<any>", () => {
    expectTypeOf<QueryResult<Query<any>>>().toBeAny();
  });
});
```

### DefineQueries produces typed union with payload handling

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineQueries, QueryResult } from "@noddde/core";

describe("DefineQueries", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView };
    ListAccounts: { result: AccountView[] };
  }>;

  it("should produce members with payload when specified", () => {
    type GetById = Extract<AccountQuery, { name: "GetAccountById" }>;
    expectTypeOf<GetById["name"]>().toEqualTypeOf<"GetAccountById">();
    expectTypeOf<GetById["payload"]>().toEqualTypeOf<{ id: string }>();
  });

  it("should produce members without explicit payload when omitted", () => {
    type ListAll = Extract<AccountQuery, { name: "ListAccounts" }>;
    expectTypeOf<ListAll["name"]>().toEqualTypeOf<"ListAccounts">();
  });

  it("should allow QueryResult to extract the result type", () => {
    type GetById = Extract<AccountQuery, { name: "GetAccountById" }>;
    expectTypeOf<QueryResult<GetById>>().toEqualTypeOf<AccountView>();
  });

  it("should allow QueryResult on the no-payload member", () => {
    type ListAll = Extract<AccountQuery, { name: "ListAccounts" }>;
    expectTypeOf<QueryResult<ListAll>>().toEqualTypeOf<AccountView[]>();
  });
});
```

### DefineQueries with void payload omits payload field

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineQueries } from "@noddde/core";

describe("DefineQueries with void payload", () => {
  type MyQuery = DefineQueries<{
    ListAll: { payload: void; result: string[] };
  }>;

  it("should not have an explicit payload property in the intersected type", () => {
    type ListAll = Extract<MyQuery, { name: "ListAll" }>;
    expectTypeOf<ListAll["name"]>().toEqualTypeOf<"ListAll">();
  });
});
```

### DefineQueries with empty record produces never

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineQueries } from "@noddde/core";

describe("DefineQueries with empty record", () => {
  type NoQueries = DefineQueries<{}>;

  it("should produce never", () => {
    expectTypeOf<NoQueries>().toBeNever();
  });
});
```
