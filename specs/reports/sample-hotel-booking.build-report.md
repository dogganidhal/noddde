## Build Report: sample-hotel-booking — Room aggregate typed-column mapper

- **Result**: GREEN-by-inspection (test execution blocked by auth)
- **Files touched**:
  - `samples/sample-hotel-booking/src/__tests__/integration/setup.ts`
  - `samples/sample-hotel-booking/src/infrastructure/persistence/db-schema.ts`
  - `samples/sample-hotel-booking/src/main.ts`
  - `samples/sample-hotel-booking/README.md`
- **New files**:
  - `samples/sample-hotel-booking/src/infrastructure/persistence/rooms-table.ts`
  - `samples/sample-hotel-booking/src/infrastructure/persistence/room-state-mapper.ts`
- **Aggregate converted**: Room
- **Other aggregates**: unchanged (Booking still on event-sourced; Inventory still on shared opaque `stateStoredPersistence`)

### Implementation notes

**`rooms-table.ts`** — defines the production PostgreSQL table (`pgTable`) with one typed column per `RoomState` field: `aggregate_id` (PK), `version`, `room_number`, `type`, `floor`, `price_per_night`, `status`, `current_booking_id`, `current_guest_id`. Nullable columns are `room_number`, `type`, `current_booking_id`, `current_guest_id` (matching `RoomState` where those fields are `string | null`).

**`room-state-mapper.ts`** — implements `DrizzleStateMapper<RoomState, typeof roomsTable>` with explicit `toRow` / `fromRow`. `fromRow` uses `?? null` / `?? 0` / `?? "created"` fallbacks to reconstruct a valid `RoomState` from the row's partial type, covering the `Partial<$inferInsert>` shape the framework passes after stripping `aggregateId` and `version`.

**`db-schema.ts`** — re-exports `roomsTable` and `roomStateMapper` from the new files so callers can import everything from a single schema barrel.

**`setup.ts` (integration tests)** — SQLite does not accept `pgTable` definitions directly, so a `sqliteRoomsTable` is defined inline (identical DDL, `sqliteTable` wrapper) alongside a `sqliteRoomStateMapper`. The `rooms` DDL is added to the bootstrap SQL, `createDrizzleAdapter` gains `aggregateStates: { Room: { table: sqliteRoomsTable, mapper: sqliteRoomStateMapper } }`, and the Room wiring changes from `eventSourcedPersistence` (with snapshot) to `drizzleInfra.stateStoreFor("Room")`. `everyNEvents` import removed.

**`main.ts` (production)** — `adapter.stateStored(roomsTable, { mapper: roomStateMapper })` is used for `Room` persistence via `DrizzleAdapter`. The `rooms` `CREATE TABLE IF NOT EXISTS` block is added to bootstrap SQL. `everyNEvents` import removed.

**README** — Persistence table updated to reflect the change (Room is now state-stored, typed table). A dedicated section explains the `DrizzleStateMapper` feature, shows the wiring snippet, and confirms Booking/Inventory are unchanged. Feature table entry 7 updated from "Snapshots" to "`DrizzleStateMapper` typed table".

### Concerns

- The integration test `setup.ts` now carries a SQLite-dialect mirror of `roomsTable`. This duplication is intentional (SQLite vs PostgreSQL column types) but means the two definitions must be kept in sync manually if `RoomState` fields change. A shared neutral schema or a test helper would reduce this drift — flagged as a potential follow-up.
- `main.ts` still uses `DrizzleAdapter` (class-based) rather than `createDrizzleAdapter` (functional). The Room wiring uses `adapter.stateStored(roomsTable, { mapper: roomStateMapper })` which returns a fresh persistence instance on every call to the `persistence` factory. This is fine (the factory is called once during `wireDomain`) but worth noting.
- `noddde_snapshots` DDL and `snapshotStore: snapshots` remain in `setup.ts` (used for no aggregate now) — left in place to avoid schema drift; they do not affect correctness.
