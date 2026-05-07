---
title: "Aggregate State Mapper Interface"
module: persistence
source_file: packages/core/src/persistence/aggregate-state-mapper.ts
status: implemented
exports:
  - AggregateStateMapper
depends_on: []
docs:
  - running/persistence-adapters.mdx
  - design-decisions/why-state-mapper.mdx
---

# Aggregate State Mapper Interface

> Bi-directional mapper between an aggregate's state object and the **state portion** of a row in a dedicated state table. Adopters supply this to a persistence adapter (Drizzle, Prisma, TypeORM, etc.) when they want their aggregate state spread across typed domain columns instead of an opaque JSON blob — the equivalent of what `better-auth` allows for its `users` table. The core interface stays intentionally minimal: `toRow(state)` produces the row's state portion, `fromRow(row)` recovers the state. Per-adapter mapper interfaces extend this with the column-pointer properties the adapter needs at query-construction time.

## Type Contract

```ts
/**
 * Bi-directional mapper between an aggregate's state object and the
 * state portion of a row in a dedicated persistence schema.
 *
 * The mapper handles only state ⇄ state-row translation. The adapter
 * writes the aggregate id and version columns itself, using column
 * references declared on the per-adapter mapper interface that
 * extends this one.
 *
 * Mappers must be pure and total: fromRow(toRow(state)) must equal
 * state for every valid state value.
 *
 * @typeParam TState - The aggregate's state type.
 * @typeParam TRow   - The shape of the row's state portion (i.e. the
 *                     full row minus the aggregate-id and version columns).
 */
export interface AggregateStateMapper<TState, TRow extends object> {
  /** State → state-row to write. */
  toRow(state: TState): TRow;
  /** State-row (id and version columns already stripped) → state. */
  fromRow(row: TRow): TState;
}
```

The interface lives in `packages/core/src/persistence/aggregate-state-mapper.ts` and is re-exported from `@noddde/core` via the persistence barrel.

No new error class. `toRow` / `fromRow` failures propagate as-is to the adapter and on to the caller.

## Behavioral Requirements

1. `AggregateStateMapper<TState, TRow>` exposes exactly two methods: `toRow(state)` and `fromRow(row)`. The interface adds no other members in the core package.
2. `toRow(state)` is synchronous and returns a plain object whose shape is `TRow`. Implementations must not mutate the input state.
3. `fromRow(row)` is synchronous and returns the recovered state. Implementations must not mutate the input row.
4. The interface is generic over `TState` and `TRow extends object`. `TState` defaults to nothing (callers always specify it). `TRow` is bounded by `object` so plain key/value rows are accepted but primitives are not.
5. The interface is purely structural — it has no construction, no required fields, no class shape. Any object literal with `toRow` and `fromRow` of compatible signatures satisfies it.
6. The interface is exported from `@noddde/core` so per-adapter packages can extend it without depending on the implementation packages.

## Invariants

- [ ] **Round-trip**: For all valid `state` values of type `TState`, `fromRow(toRow(state))` must be deeply equal to `state`. Mappers are bi-directional and lossless.
- [ ] **Purity**: `toRow` and `fromRow` produce no side effects (no I/O, no mutation of inputs, no global state).
- [ ] **Totality**: `toRow` returns for every valid `TState`; `fromRow` returns for every row produced by `toRow`. Behavior on rows from outside that domain (corrupted DB rows, partial reads) is the implementation's choice — propagate or throw.
- [ ] **Encapsulation**: The interface does not contain any column references, field names, or schema metadata. Those belong on per-adapter mapper interfaces.

## Edge Cases

- **State with `undefined` fields**: Round-trip behavior depends on the mapper's serialization choices. The interface itself imposes no constraint; mappers serializing through JSON drop `undefined`, which violates the round-trip invariant for state types that meaningfully distinguish `undefined` from missing. This is the mapper author's concern.
- **Cyclic state**: Same — depends on the mapper. The interface allows any `TState`; cyclic structures will fail when serialized through JSON. Authors must avoid cycles or write a custom mapper.
- **Empty row / missing columns on load**: The adapter strips id/version columns before calling `fromRow`; if the remaining row is empty or missing required fields, behavior is `fromRow`-defined. Throwing a clear error is recommended.
- **`TRow` excludes id and version**: Mappers should not include keys for the aggregate id or version columns in their `TRow`. Adapter implementations are free to ignore extra keys, but documenting `TRow` as "state-only" keeps mappers and adapter contracts aligned.

## Integration Points

- **Per-adapter mapper interfaces** (`DrizzleStateMapper`, `PrismaStateMapper`, `TypeORMStateMapper`) extend `AggregateStateMapper` to add column-pointer properties (`aggregateIdColumn` / `versionColumn` for Drizzle; `aggregateIdField` / `versionField` for Prisma and TypeORM).
- **Adapter `stateStored()` APIs** consume an instance of the per-adapter mapper interface and produce a `StateStoredAggregatePersistence`.
- **Adapter dedicated-state implementations** call `mapper.toRow(state)` on save, merge in `{ [idKey]: aggregateId, [verKey]: version }`, and write the resulting row. On load they read the row, strip id/version columns, call `mapper.fromRow(row)`, and return `{ state, version }`.
- **Snapshot store** (`SnapshotStore`) is unaffected: snapshots remain opaque JSON in `noddde_snapshots` regardless of whether an aggregate uses a mapper for its primary persistence.

## Test Scenarios

### Interface compiles with arbitrary `TState` and `TRow`

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { AggregateStateMapper } from "@noddde/core";

describe("AggregateStateMapper - type contract", () => {
  it("accepts arbitrary TState and TRow", () => {
    type State = { count: number };
    type Row = { c: number };
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ c: s.count }),
      fromRow: (r) => ({ count: r.c }),
    };
    expectTypeOf(mapper.toRow).parameter(0).toEqualTypeOf<State>();
    expectTypeOf(mapper.fromRow).parameter(0).toEqualTypeOf<Row>();
    expectTypeOf(mapper.toRow).returns.toEqualTypeOf<Row>();
    expectTypeOf(mapper.fromRow).returns.toEqualTypeOf<State>();
  });
});
```

### Round-trip preserves state

```ts
import { describe, it, expect } from "vitest";
import type { AggregateStateMapper } from "@noddde/core";

describe("AggregateStateMapper - round trip", () => {
  it("returns the original state through toRow then fromRow", () => {
    type State = {
      customerId: string;
      total: number;
      status: "open" | "paid" | "cancelled";
    };
    type Row = State;
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ ...s }),
      fromRow: (r) => ({ ...r }),
    };
    const state: State = {
      customerId: "c-1",
      total: 4200,
      status: "open",
    };
    expect(mapper.fromRow(mapper.toRow(state))).toEqual(state);
  });
});
```

### Mapper does not mutate inputs

```ts
import { describe, it, expect } from "vitest";
import type { AggregateStateMapper } from "@noddde/core";

describe("AggregateStateMapper - purity", () => {
  it("does not mutate the state object passed to toRow", () => {
    type State = { value: number };
    type Row = { v: number };
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ v: s.value }),
      fromRow: (r) => ({ value: r.v }),
    };
    const state: State = { value: 42 };
    const snapshot = { ...state };
    mapper.toRow(state);
    expect(state).toEqual(snapshot);
  });

  it("does not mutate the row object passed to fromRow", () => {
    type State = { value: number };
    type Row = { v: number };
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ v: s.value }),
      fromRow: (r) => ({ value: r.v }),
    };
    const row: Row = { v: 42 };
    const snapshot = { ...row };
    mapper.fromRow(row);
    expect(row).toEqual(snapshot);
  });
});
```

### Structural typing — any matching object literal satisfies the interface

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { AggregateStateMapper } from "@noddde/core";

describe("AggregateStateMapper - structural typing", () => {
  it("accepts any object with compatible toRow / fromRow methods", () => {
    type State = { name: string };
    type Row = { n: string };
    const mapper = {
      toRow: (s: State) => ({ n: s.name }),
      fromRow: (r: Row) => ({ name: r.n }),
    };
    expectTypeOf(mapper).toMatchTypeOf<AggregateStateMapper<State, Row>>();
  });
});
```

### Per-adapter interfaces extend cleanly

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { AggregateStateMapper } from "@noddde/core";

describe("AggregateStateMapper - extension", () => {
  it("can be extended with adapter-specific column pointers", () => {
    type State = { value: number };
    type Row = { v: number };
    interface MyAdapterStateMapper<TS, TR extends object>
      extends AggregateStateMapper<TS, TR> {
      readonly aggregateIdField: keyof TR & string;
      readonly versionField: keyof TR & string;
    }
    const mapper: MyAdapterStateMapper<
      State,
      Row & { id: string; ver: number }
    > = {
      aggregateIdField: "id",
      versionField: "ver",
      toRow: (s) => ({ v: s.value, id: "", ver: 0 }),
      fromRow: (r) => ({ value: r.v }),
    };
    expectTypeOf(mapper).toMatchTypeOf<
      AggregateStateMapper<State, Row & { id: string; ver: number }>
    >();
  });
});
```
