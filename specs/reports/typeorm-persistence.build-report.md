## Build Report: TypeORM Persistence (mapper)

- **Spec**: specs/typeorm/typeorm-persistence.spec.md
- **Result**: GREEN-by-inspection (test execution blocked by auth)
- **Files touched**:
  - `packages/adapters/typeorm/src/builder.ts`
  - `packages/adapters/typeorm/src/dedicated-state-persistence.ts`
  - `packages/adapters/typeorm/src/typeorm-adapter.ts`
  - `packages/adapters/typeorm/src/index.ts`
  - `packages/adapters/typeorm/src/__tests__/builder.test.ts`
  - `packages/adapters/typeorm/src/__tests__/typeorm.test.ts`
- **New files**:
  - `packages/adapters/typeorm/src/json-state-mapper.ts`

### Implementation notes

**`TypeORMStateMapper<TState, TEntity>`** (builder.ts): New interface extending `AggregateStateMapper<TState, Partial<TEntity>>` from `@noddde/core` with two readonly string keys (`aggregateIdField`, `versionField`) typed as `keyof TEntity & string`.

**`TypeORMAggregateStateTableConfig`** (builder.ts): Dropped `columns?: Partial<TypeORMStateTableColumnMap>` and the `TypeORMStateTableColumnMap` interface entirely. `entity` is now typed as `new () => TEntity` (constructor form). `mapper: TypeORMStateMapper<TState, TEntity>` is required — omitting it is a TypeScript compile error.

**`TypeORMDedicatedStateStoredPersistence`** (dedicated-state-persistence.ts): Fully rewritten. Constructor now takes `TypeORMStateMapper<TState, TEntity>` instead of `TypeORMStateTableColumnMap`. Save path: `Object.assign(entity, mapper.toRow(state), { [aggregateIdField]: id, [versionField]: expectedVersion + 1 })`. Load path: copies the row, deletes id and version properties, calls `mapper.fromRow(rest)`.

**`jsonStateMapper<TEntity>(options?)`** (json-state-mapper.ts, new): Returns a `TypeORMStateMapper<unknown, TEntity>` that JSON.stringify/parses state to/from a single column (`stateField`, default `"state"`). Handles pre-parsed object values in `fromRow` (as the original code did on line 94 of the old dedicated-state-persistence). Defaults: `aggregateIdField: "aggregateId"`, `versionField: "version"`, `stateField: "state"`.

**`TypeORMAdapter.stateStored`** (typeorm-adapter.ts): Signature changed from `stateStored(entity, columns?: Partial<TypeORMStateTableColumnMap>)` to `stateStored<TState, TEntity>(entity: new () => TEntity, options: { mapper: TypeORMStateMapper<TState, TEntity> })`. The internal `DEFAULT_COLUMNS` constant and `TypeORMStateTableColumnMap` import are removed.

**`index.ts`**: Exports `TypeORMStateMapper` (type) and `jsonStateMapper` (value). Removed `TypeORMStateTableColumnMap` from exports.

### Test files

- `packages/adapters/typeorm/src/__tests__/builder.test.ts` — Replaced old `OrderEntity` (no mapper) and `CustomOrderEntity` (column-override) tests. Added:
  - `jsonStateMapper` default-names roundtrip
  - `jsonStateMapper` with custom field names (inline DataSource to avoid entity conflict)
  - Typed-column mapper (`OrderTypedEntity` / `orderMapper`) save+load roundtrip
  - Typed-column mapper concurrency error
  - Compile-time type check (`@ts-expect-error` for missing mapper)
- `packages/adapters/typeorm/src/__tests__/typeorm.test.ts` — Added `TypeORMAdapter` class-based describe block:
  - `isPersistenceAdapter(adapter)` returns `true`
  - All stores are defined
  - `stateStored` returns persistence with save/load functions
  - `stateStored` roundtrip via `jsonStateMapper`
  - `close()` calls `dataSource.destroy()`

### Concerns

1. **`keyof TEntity & string` type assertion in `jsonStateMapper`**: The factory accepts `options.aggregateIdField?: string` (untyped, as per the spec signature) and casts to `keyof TEntity & string`. This is a runtime cast — if the caller passes a property name that doesn't exist on `TEntity`, TypeScript won't catch it at the call site (since the options are plain strings). This matches the spec's declared signature exactly; a stricter option-typed variant would be a spec change.

2. **`Object.assign` mutation on `existing` entity**: TypeORM's `findOne` returns a tracked entity. Mutating it in-place before `repo.save(existing)` is correct TypeORM usage, and the spec requires spreading `mapper.toRow(state)` into the entity. The Auditor should confirm this is the expected behavior (versus creating a fresh entity on update).

3. **Spec requirement 54 ("strips the id and version properties")**: Implemented by cloning the row object and deleting those two keys before calling `fromRow`. A typed-column mapper's `fromRow` is expected to only read state fields (id and version are not part of state), so the deletion is defensive. The Auditor should verify this matches the spec intent.
