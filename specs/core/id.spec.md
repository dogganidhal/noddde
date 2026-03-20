---
title: "ID"
module: id
source_file: packages/core/src/id.ts
status: implemented
exports: [ID]
depends_on: []
docs:
  - concepts/id-types.mdx
---

# ID

> `ID` is a type alias representing the set of serializable identifier types supported by the framework. It serves as the upper bound for all aggregate, saga, and entity identifier type parameters, enabling domains to use string UUIDs, numeric auto-increment IDs, or bigint snowflake IDs interchangeably.

## Type Contract

- **`ID`** is a type alias: `type ID = string | number | bigint`.

## Behavioral Requirements

1. `ID` is a union of three primitive types: `string`, `number`, and `bigint`.
2. `string` satisfies `ID` — covers UUIDs, ULIDs, slugs, and other string-based identifiers.
3. `number` satisfies `ID` — covers auto-increment integer IDs and small numeric identifiers.
4. `bigint` satisfies `ID` — covers 64-bit database IDs (PostgreSQL `bigserial`, Snowflake IDs).
5. Non-serializable types like `boolean`, `symbol`, `object`, and `undefined` do NOT satisfy `ID`.
6. Branded types extending `string`, `number`, or `bigint` satisfy `ID` (e.g., `string & { __brand: "UserId" }`).

## Invariants

- `ID` is a pure type alias with no runtime representation.
- `ID` contains exactly three members: `string`, `number`, `bigint`.

## Edge Cases

- **Branded string IDs**: `type UserId = string & { __brand: "UserId" }` — `UserId extends ID` is `true`.
- **Branded number IDs**: `type AccountId = number & { __brand: "AccountId" }` — `AccountId extends ID` is `true`.
- **Template literal types**: `type Prefix = \`user-${string}\``— extends`string`, so extends `ID`.
- **Literal types**: `"abc"` extends `string` extends `ID`; `42` extends `number` extends `ID`.

## Integration Points

- `ID` is the upper bound for `AggregateCommand<TID extends ID>`, `DefineCommands<TPayloads, TID extends ID>`, `Saga<T, TSagaId extends ID>`, and `defineSaga<T, TSagaId extends ID>`.
- `EventMetadata.aggregateId` and `EventMetadata.userId` are typed as `ID | undefined`.
- Persistence interfaces use `ID` for `aggregateId` and `sagaId` parameters.
- `ConcurrencyError`, `AggregateLocker`, and `LockTimeoutError` use `ID` for `aggregateId`.

## Test Scenarios

### ID accepts string, number, and bigint

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ID } from "@noddde/core";

describe("ID", () => {
  it("should accept string", () => {
    expectTypeOf<string>().toMatchTypeOf<ID>();
  });

  it("should accept number", () => {
    expectTypeOf<number>().toMatchTypeOf<ID>();
  });

  it("should accept bigint", () => {
    expectTypeOf<bigint>().toMatchTypeOf<ID>();
  });
});
```

### ID rejects non-serializable types

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ID } from "@noddde/core";

describe("ID rejects non-serializable types", () => {
  it("should not accept boolean", () => {
    expectTypeOf<boolean>().not.toMatchTypeOf<ID>();
  });

  it("should not accept symbol", () => {
    expectTypeOf<symbol>().not.toMatchTypeOf<ID>();
  });

  it("should not accept object", () => {
    expectTypeOf<{ id: string }>().not.toMatchTypeOf<ID>();
  });
});
```

### ID accepts branded types

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ID } from "@noddde/core";

describe("ID accepts branded types", () => {
  type UserId = string & { __brand: "UserId" };
  type AccountId = number & { __brand: "AccountId" };

  it("should accept branded string", () => {
    expectTypeOf<UserId>().toMatchTypeOf<ID>();
  });

  it("should accept branded number", () => {
    expectTypeOf<AccountId>().toMatchTypeOf<ID>();
  });
});
```
