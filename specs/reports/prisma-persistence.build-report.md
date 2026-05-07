## Build Report: Prisma Persistence (mapper)

- **Spec**: specs/prisma/prisma-persistence.spec.md
- **Result**: GREEN-by-inspection (test execution blocked by auth)
- **Files touched**:
  - `packages/adapters/prisma/src/builder.ts`
  - `packages/adapters/prisma/src/dedicated-state-persistence.ts`
  - `packages/adapters/prisma/src/prisma-adapter.ts`
  - `packages/adapters/prisma/src/index.ts`
  - `packages/adapters/prisma/src/__tests__/builder.test.ts`
  - `packages/adapters/prisma/src/__tests__/prisma.test.ts`
- **New files**:
  - `packages/adapters/prisma/src/json-state-mapper.ts`

### Implementation notes

**`PrismaStateMapper` interface** (builder.ts): Added as a new exported interface extending `AggregateStateMapper<TState, Partial<TRow>>` with `aggregateIdField: keyof TRow & string` and `versionField: keyof TRow & string`. Importing `AggregateStateMapper` from `@noddde/core` (already exported via `packages/core/src/persistence/index.ts`).

**`PrismaAggregateStateTableConfig`** (builder.ts): Converted from a monomorphic interface with optional `columns?` to a generic interface `<TState, TRow>` with a required `mapper: PrismaStateMapper<TState, TRow>`. Removed `PrismaStateTableColumnMap` entirely — no other file in the adapter referenced it except `builder.ts`, `dedicated-state-persistence.ts`, and `prisma-adapter.ts`.

**`createPrismaAdapter`** (builder.ts): The `aggregateStates` loop no longer merges `DEFAULT_COLUMNS` — it passes `aggConfig.mapper` directly to `PrismaDedicatedStateStoredPersistence`. The `DEFAULT_COLUMNS` constant was removed.

**`PrismaDedicatedStateStoredPersistence`** (dedicated-state-persistence.ts): Constructor now takes `mapper: PrismaStateMapper<unknown, Record<string, unknown>>` instead of `columns: PrismaStateTableColumnMap`. Save operations spread `mapper.toRow(state)` first, then overwrite the id/version fields (so the mapper cannot accidentally override them). Load uses computed-property destructuring to strip the id and version fields from the raw row before calling `mapper.fromRow(stateRow)`.

**`jsonStateMapper`** (json-state-mapper.ts, new): Returns a `PrismaStateMapper<unknown, Record<string, unknown>>`. `toRow` returns `{ [stateField]: JSON.stringify(state) }`. `fromRow` handles both `string` (normal case) and already-parsed objects (some Prisma drivers / test mocks may return the JSON pre-parsed). Defaults: `aggregateIdField: "aggregateId"`, `versionField: "version"`, `stateField: "state"`. Partial overrides are supported.

**`PrismaAdapter.stateStored`** (prisma-adapter.ts): Signature changed from `stateStored(model, columns?: Partial<PrismaStateTableColumnMap>)` to `stateStored<TState, TRow>(model, options: { mapper: PrismaStateMapper<TState, TRow> })`. The `DEFAULT_COLUMNS` constant and the `columns` parameter are gone. The method casts `options.mapper` to the erased internal type for `PrismaDedicatedStateStoredPersistence`.

**`index.ts`**: Replaced the `PrismaStateTableColumnMap` re-export with `PrismaStateMapper`. Added `jsonStateMapper` re-export from `./json-state-mapper`.

**Test strategy**: `builder.test.ts` was rewritten to use the mapper API throughout. The unit mock for `PrismaDedicatedStateStoredPersistence` now uses `jsonStateMapper()` instead of a raw column map. Additional unit tests cover: `toRow`/`fromRow` call counts (invariant), `jsonStateMapper` defaults and overrides, and the `PrismaAdapter` class (implements `PersistenceAdapter`, `stateStored`, `close`). `prisma.test.ts` gains a new `describe` block with unit-style mocks for the per-aggregate scenarios (jsonStateMapper roundtrip, stateStoreFor fast-fail, ConcurrencyError on version mismatch, UoW transaction participation, invalid model validation).

**Integration tests for typed-column mapper** (spec test scenarios "typed-column mapper roundtrip" and "typed-column mapper concurrency") require a real Prisma schema with a custom `Order` model (typed columns `aggregateId`, `version`, `customerId`, `total`, `status`). This model is not present in the existing test schema (`prisma/schema.prisma`). These scenarios are documented as spec test scenarios but cannot be run without extending the test schema — noted below as a concern for the Auditor.

### Test files

- `packages/adapters/prisma/src/__tests__/builder.test.ts` — full rewrite with mapper API
- `packages/adapters/prisma/src/__tests__/prisma.test.ts` — appended new describe block for per-aggregate mapper unit tests

### Concerns

1. **Typed-column integration tests**: The spec's "typed-column mapper roundtrip" and "typed-column mapper concurrency" test scenarios (lines 1111–1196 of the spec) reference `prisma.order.findUnique` and `Prisma.OrderUncheckedCreateInput`. The test database schema (`packages/adapters/prisma/prisma/schema.prisma`) does not contain an `Order` model with typed columns. These tests cannot be run against the existing schema. The Auditor should decide whether to extend the schema or treat those scenarios as documentation-only type-check tests.

2. **`eslint-disable no-unused-vars`**: The computed-property destructuring in `dedicated-state-persistence.ts` (`const { [this.mapper.aggregateIdField]: _id, [this.mapper.versionField]: _ver, ...stateRow } = row`) produces two unused local bindings. The existing file-level `/* eslint-disable no-unused-vars */` suppresses this. If the project moves to `@typescript-eslint/no-unused-vars` with `destructuredArrayIgnorePattern`, this suppression may need revision.

3. **Spec requirement 43 removed**: The spec (line 43 of behavioral requirements) states `PrismaAggregateStateTableConfig` has `columns?: Partial<PrismaStateTableColumnMap>`. This was intentionally removed by the migration — the spec's Migration section supersedes requirement 43. The Auditor should confirm requirement 43 is considered superseded/obsolete by the mapper API.
