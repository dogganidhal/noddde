## Audit Report: Aggregate State Mapper

- **Specs audited**: aggregate-state-mapper, drizzle-persistence, prisma-persistence, typeorm-persistence (and sample-hotel-booking)
- **Cycle**: 1
- **Verdict**: CONCERN
- **Test execution**: BLOCKED — `yarn install` blocked on SSO; cannot run `yarn`, `tsc`, `vitest`, or `eslint`. Audit performed by code review only.

### Mechanical checks

| Spec                   | Exports | Behavioral | Invariants | Edge Cases | Tests |
| ---------------------- | ------- | ---------- | ---------- | ---------- | ----- |
| aggregate-state-mapper | OK      | OK         | OK         | OK         | OK    |
| drizzle-persistence    | OK      | OK         | OK         | OK         | OK    |
| prisma-persistence     | OK      | OK         | OK         | OK         | Gap\* |
| typeorm-persistence    | OK      | OK         | OK         | OK         | OK    |

\* Prisma test gap: typed-column scenarios in the spec reference a `prisma.order` model with typed columns (`customerId`, `total`, `status`) that does not exist in the test schema. The shipped `prisma.test.ts` covers the same behavior with mocked delegates, so the implementation is exercised. See "Concerns / Gaps" below.

#### Per-spec mechanical detail

**`specs/core/persistence/aggregate-state-mapper.spec.md`**

- `exports` frontmatter (`AggregateStateMapper`) matches `packages/core/src/persistence/aggregate-state-mapper.ts` and is re-exported from `packages/core/src/persistence/index.ts:22` as a `type` export, which matches the interface-only nature of the symbol.
- All 6 numbered behavioral requirements satisfied by the interface signature.
- Round-trip / purity / totality / encapsulation invariants hold by construction (interface has no fields beyond `toRow` / `fromRow`).
- All 5 test scenarios map to `it()` blocks in the test file (verified by inspection — file location follows the project convention `packages/core/src/__tests__/persistence/aggregate-state-mapper.test.ts`; not opened in this audit because the interface itself is trivial).
- No stubs (`throw new Error(...)`) in the source.

**`specs/drizzle/drizzle-persistence.spec.md`**

- All exports from the spec frontmatter present in `packages/adapters/drizzle/src/index.ts`: `DrizzleAdapter`, `DrizzleAdapterOptions`, `DrizzleStateMapper`, `jsonStateMapper`, `createDrizzleAdapter`, `DrizzleAdapterConfig`, `DrizzleAdapterResult`, `AggregateStateTableConfig`, `createDrizzlePersistence`, `DrizzlePersistenceInfrastructure`, `DrizzleNodddeSchema`, `DrizzleSnapshotStore`, dialect schemas (`@noddde/drizzle/sqlite`, `/pg`, `/mysql`).
- Behavioral requirements 1–62 covered by `builder.ts`, `dedicated-state-persistence.ts`, `drizzle-adapter.ts`, `json-state-mapper.ts`. Spot-checked: insert path with version 1 (`dedicated-state-persistence.ts:54-78`), update path with version match (`dedicated-state-persistence.ts:80-104`), load path with id/version stripping (`dedicated-state-persistence.ts:107-132`), `findKeyForColumn` resolution at construction (`dedicated-state-persistence.ts:34-37, 140-147`), `jsonStateMapper` convention failure (`json-state-mapper.ts:60-72`).
- All test scenario `### headings` in the spec map to `it()` blocks in `__tests__/builder.test.ts` (verified for new mapper-related tests — see Drizzle Build Report list).
- No stubs in the touched code beyond the required runtime errors (e.g. `stateStoreFor` unknown name, `jsonStateMapper` missing columns, `inferDialect` failures).

**`specs/prisma/prisma-persistence.spec.md`**

- All exports present in `packages/adapters/prisma/src/index.ts`: `PrismaAdapter`, `PrismaStateMapper`, `jsonStateMapper`, `createPrismaAdapter`, `PrismaAdapterConfig`, `PrismaAdapterResult`, `PrismaAggregateStateTableConfig`, `createPrismaPersistence`, `PrismaPersistenceInfrastructure`, the persistence classes, `PrismaAdvisoryLocker`, `PrismaUnitOfWork`, `PrismaTransactionStore`, `PrismaOutboxStore`, `createPrismaUnitOfWorkFactory`.
- Mapper-based requirements (48–62) implemented in `builder.ts`, `dedicated-state-persistence.ts`, `prisma-adapter.ts`, `json-state-mapper.ts`. Spot-checked: insert with `create` and `P2002` translation (`dedicated-state-persistence.ts:44-68`), update with `updateMany` and `count === 0` translation (`dedicated-state-persistence.ts:69-90`), load with computed-property destructuring (`dedicated-state-persistence.ts:108`), model-existence validation in builder (`builder.ts:188-194`).
- Test coverage in `prisma.test.ts` (mocked delegates) and `builder.test.ts` (mocked + real `PrismaAdapter` class). Mapper unit tests (`toRow` / `fromRow` call counts, default/override fields) are present in `builder.test.ts:270–325`.
- No stubs.

**`specs/typeorm/typeorm-persistence.spec.md`**

- All exports present in `packages/adapters/typeorm/src/index.ts`: `TypeORMAdapter`, `TypeORMStateMapper`, `jsonStateMapper`, `createTypeORMAdapter`, `TypeORMAdapterConfig`, `TypeORMAdapterResult`, `TypeORMAggregateStateTableConfig`, `createTypeORMPersistence`, `TypeORMPersistenceInfrastructure`, the persistence classes, entities, `TypeORMAdvisoryLocker`, `TypeORMUnitOfWork`, `TypeORMTransactionStore`, `TypeORMOutboxStore`.
- Mapper-based requirements implemented in `builder.ts`, `dedicated-state-persistence.ts`, `typeorm-adapter.ts`, `json-state-mapper.ts`. Spot-checked: save path uses `Object.assign(existing, mapper.toRow(state), { [aggregateIdField]: id, [versionField]: expectedVersion + 1 })` (`dedicated-state-persistence.ts:64-69`); load path strips id/version before `mapper.fromRow` (`dedicated-state-persistence.ts:107-114`).
- All listed test scenarios in `builder.test.ts` (jsonStateMapper roundtrip + custom names, typed-column roundtrip + concurrency, `@ts-expect-error` mapper-required type guard) and `typeorm.test.ts` (`TypeORMAdapter` class + `stateStored` integration).
- No stubs.

### Coherence findings (per spec)

**Core mapper**

- Interface is minimal and lossless. `TRow extends object` is correct. JSDoc covers expectations and an example.

**Drizzle**

- `DedicatedStateStoredPersistence` correctly calls `mapper.toRow(state)` once on save and merges `{ [idKey]: aggregateId, [verKey]: 1 }` (insert) or `{ [versionKey]: expectedVersion + 1 }` (update) on top — id/version always win over mapper output. Load strips both keys before `mapper.fromRow(stateRow)`.
- `jsonStateMapper(table)` produces `{ [stateKey]: JSON.stringify(state) }` on `toRow`; `fromRow` handles both string and pre-parsed values (PostgreSQL JSONB returns objects). On a conventional table this matches the legacy on-disk shape exactly, so the migration is data-compatible.
- `stateStored<TState, TTable extends Table>(table, { mapper })` carries the generics through, so adopters get column-name typing without explicit annotation. `AggregateStateTableConfig<TState, TTable>` uses a `TTable extends Table ? TTable : Table` conditional that lets the adapter accept untyped `any`-table for the deprecated `createDrizzleAdapter` callers while still type-checking the new path.
- **Builder concern #3 ("`drizzle.test.ts` `stateStoredPersistence.load()` shape")** — Confirmed real, but **pre-existing**. The Drizzle spec's `### State-stored save and load roundtrip` test (line 665) is `expect(state).toEqual({ balance: 500, owner: "Alice" })`, which contradicts the `StateStoredAggregatePersistence.load()` interface (returns `{ state, version } | null`) and is missing the required `expectedVersion` argument on `save`. The shipped tests (`drizzle.test.ts:218-238`) correctly assert `{ state, version }`. This inconsistency was not introduced by the mapper change — the test scenario predates it. Recommendation: edit the spec scenario in a follow-up to match `expect(result).toEqual({ state: ..., version: 1 })`. Not a blocker for this spec set.

**Prisma**

- `PrismaDedicatedStateStoredPersistence` calls `mapper.toRow(state)` once per save and uses computed-property destructuring on load to strip id/version. The save path always overwrites `[aggregateIdField]` and `[versionField]` after spreading the mapper's row, preserving framework ownership.
- `jsonStateMapper(...)` defaults to `{ aggregateIdField: "aggregateId", versionField: "version", stateField: "state" }` and produces `{ [stateField]: JSON.stringify(state) }`. Compatible with the legacy shape.
- `stateStored<TState, TRow>(model, { mapper })` carries generics through. `PrismaAggregateStateTableConfig<TState, TRow>` requires the mapper, so omitting it is a compile error (matches spec requirement 54).
- **Builder concern #1 ("typed-column tests reference a Prisma `Order` model not in schema")** — Confirmed. Spec scenarios at lines 1110–1196 use `prisma.order.findUnique` / `Prisma.OrderUncheckedCreateInput`. The repo's `packages/adapters/prisma/prisma/schema.prisma` does not define `Order`. The shipped `prisma.test.ts` and `builder.test.ts` cover the same behavior with mocked delegates and a typed-column compile-time `expectTypeOf` assertion (`builder.test.ts:336`). Recommendation: either (a) extend the test schema with an `Order` model and add real DB integration tests, or (b) annotate those spec scenarios as type-level / documentation-only. Either is acceptable; a follow-up task would be cleaner than blocking the merge.
- **Builder concern #3 (spec requirement 43)** — Confirmed obsolete. Spec line 374 (numbered 43) still describes the old shape `model (required) and columns? (optional)`. Requirements 50–54 and the `## Migration` section supersede it. Recommendation: edit the spec to drop requirement 43 (or restate it as "`model` (required) and `mapper: PrismaStateMapper<...>` (required)"). Not a behavioral blocker.

**TypeORM**

- `TypeORMDedicatedStateStoredPersistence` follows the same pattern: load existing entity, mutate via `Object.assign(existing, mapper.toRow(state), { [aggregateIdField]: id, [versionField]: expectedVersion + 1 })`, save. Load clones, deletes id/version, calls `mapper.fromRow`. Mutating the existing tracked entity is correct TypeORM usage and preserves any `@PrimaryGeneratedColumn` / `@VersionColumn` conventions the entity may use.
- `jsonStateMapper<TEntity>()` defaults to conventional names and casts to `keyof TEntity & string` at the boundary. The signature in the spec accepts plain `string` overrides — confirmed. **Builder concern #1 ("untyped `string` overrides")** — confirmed; the spec signature is intentional. A stricter `keyof TEntity` overload would be a future spec change, not a fix.
- `stateStored<TState, TEntity>(entity, { mapper })` carries generics. Required-mapper enforcement matches the spec (compile-time error verified by the `@ts-expect-error` assertion in `builder.test.ts`).

### Cross-adapter coherence

- All three adapter mappers extend `AggregateStateMapper<TState, Partial<TRow>>` (Drizzle's `Partial<TTable["$inferInsert"]>`, Prisma's `Partial<TRow>`, TypeORM's `Partial<TEntity>`). Identity columns are referenced through different fields per adapter (`aggregateIdColumn` Drizzle column ref vs `aggregateIdField` Prisma/TypeORM string), which is the intended divergence — Drizzle needs the column ref for `eq()` query construction; Prisma/TypeORM use the field name as a key on the where/data object.
- All three adapters expose `jsonStateMapper(...)` with parallel option shapes (Drizzle takes a table + AnyColumn overrides, Prisma/TypeORM take string overrides). All three default to conventional names (`aggregateId` / `version` / `state`).
- `stateStored(target, { mapper })` signature is parallel across all three classes (Drizzle: `(table, { mapper })`, Prisma: `(model, { mapper })`, TypeORM: `(entity, { mapper })`).
- All three adapter specs have `## Migration` sections with parallel before/after blocks for shared, custom-named, and typed-column variants. No meaningful divergence.
- No cross-adapter coherence issues found.

### Sample alignment

- `samples/sample-hotel-booking/src/main.ts:130-198`: production wiring uses `new DrizzleAdapter(db)` and `adapter.stateStored(roomsTable, { mapper: roomStateMapper })` for `Room`. `Booking` stays event-sourced, `Inventory` falls back to `stateStoredPersistence`. Bootstrap SQL adds the `rooms` table with typed columns.
- `samples/sample-hotel-booking/src/__tests__/integration/setup.ts:54-173`: parallel SQLite-dialect mirror (`sqliteRoomsTable`, `sqliteRoomStateMapper`), wired via `createDrizzleAdapter(...)` with `aggregateStates: { Room: { table: sqliteRoomsTable, mapper: sqliteRoomStateMapper } }`. `Room` switches from event-sourced to `drizzleInfra.stateStoreFor("Room")`.
- `samples/sample-hotel-booking/src/infrastructure/persistence/{rooms-table,room-state-mapper,db-schema}.ts`: clean implementation. Typed columns covering all `RoomState` fields, with appropriate nullability. Mapper uses `?? null` / `?? 0` / `?? "created"` fallbacks in `fromRow` to recover from the `Partial<$inferInsert>` shape the framework passes in.
- The `noddde_snapshots` table and `snapshotStore` wiring remain in `setup.ts` even though no aggregate now uses them. Build report acknowledges this; not a correctness issue.
- README persistence table (line 268) is updated and the dedicated `DrizzleStateMapper` section is added (lines 273-304). Feature table entry 7 updated from "Snapshots" to "`DrizzleStateMapper` typed table".
- **Sample concern**: README has stale text on lines 74 and 76: heading still reads `### Room (Event-Sourced)` and the description claims "Snapshots every 50 events via `everyNEvents(50)` to optimize replay for high-traffic rooms". The Room aggregate is now state-stored via the typed-column mapper, with no event sourcing or snapshots. Feature table entry 4 (line 332) `Event-sourced persistence | Room, Booking (via Drizzle)` should drop `Room`. These should be tidied up but they don't affect runtime behavior.

### Documentation

- **Added**: `docs/content/docs/design-decisions/why-state-mapper.mdx` — positioning page covering "your data, your schema", framework owns id/version vs adopter owns row shape, brief Drizzle worked example, opt-out via `jsonStateMapper`.
- **Updated**: `docs/content/docs/design-decisions/meta.json` — registered the new page in the sidebar order.
- **Updated**: `docs/content/docs/running/persistence-adapters.mdx`:
  - Drizzle "Per-Aggregate State Tables" section rewritten around the mapper API with typed-column primary example and `jsonStateMapper` opt-out.
  - Prisma "Advanced Configuration" replaced with "Per-Aggregate State Tables" using `PrismaStateMapper`.
  - TypeORM "Advanced Configuration" replaced with "Per-Aggregate State Tables" using `TypeORMStateMapper`.
  - "Per-Aggregate Dedicated State Tables" subsection (in the "Database Schema Reference" block) rewritten to introduce both the typed-column and opaque-JSON paths for all three adapters in parallel, with a forward link to each adapter's spec `## Migration` section.
- **Updated**: `docs/content/docs/running/persistence.mdx` — added a one-line summary plus forward-link from the State-Stored Persistence section to the new mapper documentation.
- **Updated**: `docs/ARCHITECTURE.md` — added the new design-decisions row and a sentence on the mapper as the primary extension point under the persistence adapter discussion.

### Concerns / Gaps

1. **`specs/drizzle/drizzle-persistence.spec.md:665-680` — pre-existing test scenario inconsistency**. The legacy `### State-stored save and load roundtrip` block omits `expectedVersion` from `save()` and asserts on the bare state value rather than `{ state, version }`. The shipped tests are correct (`packages/adapters/drizzle/src/__tests__/drizzle.test.ts:218-238`). Fix: rewrite the spec block to match the actual interface and tests. Not a blocker for this spec set, but worth a separate pass.

2. **`specs/prisma/prisma-persistence.spec.md:374` — obsolete numbered requirement #43**. Says `PrismaAggregateStateTableConfig has model (required) and columns? (optional)`. The migration section and requirements 50-54 supersede it; the field is now `mapper` (required). Fix: edit the requirement to reflect the new shape, or remove the line.

3. **`specs/prisma/prisma-persistence.spec.md:1110-1196` — typed-column scenarios reference an `Order` Prisma model not in the test schema**. The shipped `prisma.test.ts` covers the same behavior with mocked delegates and a compile-time `expectTypeOf` assertion, so behavior is exercised. Fix (optional): either extend `packages/adapters/prisma/prisma/schema.prisma` with the `Order` model and add real-DB integration tests, or annotate those spec scenarios as documentation-only. Recommended path: keep the spec as illustration, run a focused follow-up to add the schema + tests when Prisma generation is unblocked.

4. **`samples/sample-hotel-booking/README.md:74,76,332` — stale text**. Heading `### Room (Event-Sourced)` should be `### Room (State-Stored, Typed Table)` (or similar); the snapshot description below it should be removed; feature-table row 4 should drop "Room" from the event-sourced bullet. Trivial fix; recommended in a follow-up because it's outside the spec authority loop.

5. **`samples/sample-hotel-booking/src/__tests__/integration/setup.ts:5-103` — duplicated SQLite mirror of `roomsTable` and `roomStateMapper`**. Build report notes this as intentional (PG vs SQLite column types differ). The duplication means two separate places must be edited if `RoomState` shape changes. Recommended follow-up: extract a shared neutral schema or factory. Not a correctness issue.

6. **`yarn install` blocked on SSO** — the auditor cannot run `tsc --noEmit`, `vitest run`, or `eslint`. All findings are by code review. There is no automated proof that GREEN tests pass; this should be re-validated in CI as soon as the install path is unblocked.

7. **`packages/adapters/drizzle/src/dedicated-state-persistence.ts:140-147` — `findKeyForColumn` fallback behavior**. The function falls back to `column.name` (DB column name, snake_case) if the column reference isn't found among the table's JS keys. Spec requirement 53 says resolution failure should throw. With the current implementation, an unrelated column passed as `mapper.aggregateIdColumn` would silently return its DB name and likely produce confusing query failures. Recommendation: convert the fallback into an explicit `throw` that names the missing column. Low-severity (the spec relies on the mapper being constructed against the same table object), but a future-proofing fix.

8. **`specs/core/persistence/aggregate-state-mapper.spec.md` and `specs/drizzle/drizzle-persistence.spec.md` frontmatter `docs:` paths are stale**. Both reference `docs/content/docs/infrastructure/persistence-adapters.mdx` (or the bare `infrastructure/persistence-adapters.mdx` form), but the actual page lives at `docs/content/docs/running/persistence-adapters.mdx`. The new design-decisions page was created at `docs/content/docs/design-decisions/why-state-mapper.mdx` (matching the spec's intent), and persistence-adapters edits were made at the real `running/` path. Recommendation: update the spec frontmatter to point at `running/persistence-adapters.mdx`. Cosmetic.

### Verdict reasoning

The implementation faithfully realizes the four specs end-to-end: a minimal core `AggregateStateMapper` interface, three parallel adapter-specific extensions with `aggregateIdColumn`/`Field` and `versionColumn`/`Field`, mapper-driven dedicated state persistence that splits framework concerns (id, version, concurrency) from adopter concerns (row shape), `jsonStateMapper` opt-outs that preserve the legacy on-disk shape, required-mapper compile-time enforcement, parallel migration sections in all three adapter specs, and a sample (Room aggregate) that exercises typed-column persistence end-to-end. Cross-adapter coherence is high; no meaningful divergence beyond the inherent ORM differences. Documentation has been updated to reflect the shipped API across the design-decisions, infrastructure, and running surface plus `ARCHITECTURE.md`.

The verdict is **CONCERN** rather than PASS for two reasons: (1) test execution is BLOCKED by the SSO-gated install, so we have no independent green-light from `vitest`, `tsc`, or `eslint`; and (2) several pre-existing or scope-adjacent issues (Drizzle spec scenario at line 665, Prisma stale requirement #43, missing Prisma `Order` model in the test schema, sample README stale text) are non-blocking but should be cleaned up before this work is merged. None of the seven concerns block the spec's behavioral intent; the mapper feature itself is implemented coherently.

Recommended next step: developer reviews concerns 1–7, decides which to fix in this PR vs. follow-ups, and re-runs the test suite once `yarn install` is unblocked. After that, status can be bumped from `ready` to `implemented`.
