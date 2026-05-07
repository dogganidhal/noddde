## Build Report: Drizzle Persistence (mapper)

- **Spec**: specs/drizzle/drizzle-persistence.spec.md
- **Result**: GREEN-by-inspection (test execution blocked by auth)
- **Files touched**:
  - `packages/adapters/drizzle/src/builder.ts`
  - `packages/adapters/drizzle/src/dedicated-state-persistence.ts`
  - `packages/adapters/drizzle/src/drizzle-adapter.ts`
  - `packages/adapters/drizzle/src/index.ts`
  - `packages/adapters/drizzle/src/__tests__/builder.test.ts`
  - `packages/adapters/drizzle/src/__tests__/drizzle.test.ts`
- **New files**: `packages/adapters/drizzle/src/json-state-mapper.ts`
- **Deleted files**: `packages/adapters/drizzle/src/column-resolver.ts`

### Implementation notes

**`DrizzleStateMapper<TState, TTable>`** (in `builder.ts`):

- Defined as `interface DrizzleStateMapper<TState, TTable extends Table> extends AggregateStateMapper<TState, Partial<TTable["$inferInsert"]>>` with `aggregateIdColumn: AnyColumn` and `versionColumn: AnyColumn`.
- This is the single source of truth for the row schema; the adapter writes id and version columns itself using the JS keys resolved from the column references.

**`AggregateStateTableConfig`** (in `builder.ts`):

- Dropped the optional `columns?: Partial<StateTableColumnMap>` field.
- Now requires `mapper: DrizzleStateMapper<TState, TTable extends Table ? TTable : Table>`.
- `StateTableColumnMap` interface entirely removed from `builder.ts` and `index.ts`.

**`jsonStateMapper`** (new file `json-state-mapper.ts`):

- Resolves `aggregateIdColumn`, `versionColumn`, and `stateColumn` by JS-key convention (`table.aggregateId`, `table.version`, `table.state`). Throws at call time with a message containing all missing key names (`aggregateId`, `state`, `version`) when any are missing — matches the spec's `/aggregateId.*state.*version/` regex.
- Options parameter allows overriding any subset of the three column references.
- `toRow(state)` returns `{ [stateKey]: JSON.stringify(state) }`.
- `fromRow(row)` returns `JSON.parse(row[stateKey])` when the value is a string; returns the value as-is when already deserialized (JSONB dialect behavior from PG).

**`DrizzleDedicatedStateStoredPersistence`** (in `dedicated-state-persistence.ts`):

- Constructor now takes `(db, txStore, table, mapper: DrizzleStateMapper<any, any>)` instead of `(db, txStore, table, columns: StateTableColumnMap)`.
- Resolves `idKey` and `versionKey` once at construction via `findKeyForColumn(table, mapper.aggregateIdColumn)` / `findKeyForColumn(table, mapper.versionColumn)`. No separate `stateKey` is needed (the mapper handles state columns).
- Insert path: spreads `mapper.toRow(state)` then merges `{ [idKey]: aggregateId, [verKey]: 1 }` so the adapter's id/version always take precedence.
- Update path: spreads `mapper.toRow(state)` in the `.set()`, then adds `{ [versionKey]: expectedVersion + 1 }`.
- Load path: strips `idKey` and `versionKey` from the loaded row before passing the remainder to `mapper.fromRow()`.

**`DrizzleAdapter.stateStored()`** (in `drizzle-adapter.ts`):

- Signature changed from `stateStored(table, columns?: Partial<StateTableColumnMap>)` to `stateStored<TState, TTable extends Table>(table: TTable, options: { mapper: DrizzleStateMapper<TState, TTable> })`.
- No longer imports or uses `column-resolver`. The returned persistence shares the adapter's `txStore`.

**`column-resolver.ts` deleted**: Convention-based column resolution by DB name (`aggregate_id`, `state`, `version`) is replaced by JS-key convention in `jsonStateMapper` (`aggregateId`, `state`, `version`). These are different conventions — the old resolver used DB column names; the new helper uses JS property keys on the table object.

### Test files

**`packages/adapters/drizzle/src/__tests__/builder.test.ts`** — complete rewrite:

- Removed: all tests using `{ table: ordersTable }` (no mapper) and `{ table: customOrdersTable, columns: { ... } }` (old columns API).
- Updated: `"creates all stores when fully configured"` → `"creates all stores with shared txStore"` using `jsonStateMapper`.
- Added:
  - `"factory creates all infrastructure components"` (spec line 490)
  - `"creates all stores with shared txStore"` (spec line 1119)
  - `"stateStoredPersistence is absent when stateStore not in config"` (spec line 1145)
  - `"backwards compat: createDrizzlePersistence delegates to createDrizzleAdapter"` (spec line 1160)
  - `"per-aggregate state table: jsonStateMapper save and load roundtrip"` (spec line 1184)
  - `"per-aggregate state table: returns null for nonexistent"` (spec line 1249)
  - `"per-aggregate state table: throws ConcurrencyError on version mismatch"` (spec line 1269)
  - `"per-aggregate state table: jsonStateMapper accepts column overrides"` (spec line 1292)
  - `"per-aggregate state table: typed-column mapper writes and reads typed rows"` (spec line 1351)
  - `"typed-column mapper: throws ConcurrencyError on version mismatch"` (spec line 1448)
  - `"typed-column mapper: TS rejects mappers with mismatched row keys"` (spec line 1505, compile-time only)
  - `"stateStoreFor throws for unconfigured aggregate"` (spec line 1523)
  - `"per-aggregate state table: participates in UoW transaction"` (spec line 1544)
  - `"jsonStateMapper throws clear error when convention resolution fails"` (spec line 1586)

**`packages/adapters/drizzle/src/__tests__/drizzle.test.ts`** — minimal additions:

- Added imports: `sqliteTable`, `text`, `integer`, `isPersistenceAdapter`, `DrizzleAdapter`, `jsonStateMapper`.
- Added `customStateTable` table definition for `DrizzleAdapter.stateStored` test.
- Added new `describe("DrizzleAdapter")` block with four `it()` tests:
  - `"DrizzleAdapter implements PersistenceAdapter"` (spec `## Test Scenarios (DrizzleAdapter)` line 1820)
  - `"DrizzleAdapter provides all stores"` (spec line 1830)
  - `"DrizzleAdapter.stateStored returns dedicated persistence"` (spec line 1843)
  - `"DrizzleAdapter close is a no-op"` (spec line 1858)
- Pre-existing tests (event-sourced, state-stored, saga, UoW, snapshot, outbox) are unchanged.

### Concerns

1. **Convention change**: The old `column-resolver.ts` resolved by DB column names (`aggregate_id`, `state`, `version` in snake_case). The new `jsonStateMapper` convention resolves by JS property keys (`aggregateId`, `state`, `version` in camelCase). Existing users who relied on the old convention-based resolution (without explicit columns) used the DB-name convention. The new convention uses JS-key names. Since the prebuilt schemas (`@noddde/drizzle/sqlite`, `/pg`, `/mysql`) already use `aggregateId`, `state`, `version` as JS keys (they're the SQLite schema's column definitions), `jsonStateMapper(aggregateStates)` will work correctly with those schemas. However, custom tables that had columns matching the old DB-name convention (but with different JS keys) will need to migrate.

2. **`createDrizzleAdapter` deprecation note**: The spec section `### Deprecation` at line 1806 mentions `createDrizzleAdapter` should be marked `@deprecated` in favor of `new DrizzleAdapter(db, options)`. The current implementation does not mark it deprecated (prior state had no such annotation). This could be flagged as a spec-code discrepancy for the Auditor to review — the migration guide in the spec focuses on the mapper API, not the `createDrizzleAdapter`→`DrizzleAdapter` migration. The builder task instructions focused on the mapper changes, so this was intentionally deferred.

3. **`drizzle.test.ts` assertions**: The pre-existing tests in `drizzle.test.ts` assert `{ state: ..., version: ... }` for `stateStoredPersistence.load()`, which is correct per the `StateStoredAggregatePersistence` interface. The spec's test scenario for `### State-stored save and load roundtrip` (line 665) uses `createDrizzleAdapter` and asserts `expect(state).toEqual({ balance: 500, owner: "Alice" })` — which would be incorrect for `StateStoredAggregatePersistence.load()` (returns `{state, version} | null`). This appears to be a spec test scenario inconsistency. The existing tests are correct and were not changed.
