---
title: "IdempotencyStore & IdempotencyRecord"
module: persistence/idempotency
source_file: packages/core/src/persistence/idempotency.ts
status: implemented
exports: [IdempotencyRecord, IdempotencyStore]
depends_on: [id]
docs:
  - running/idempotent-commands.mdx
  - running/domain-configuration.mdx
---

# IdempotencyStore & IdempotencyRecord

> Defines the contract for idempotent command processing. An `IdempotencyStore` tracks which commands have been processed, enabling the domain engine to skip duplicate commands. An `IdempotencyRecord` captures the metadata of a processed command. Together they prevent duplicate event production and side effects from repeated command delivery.

## Type Contract

```ts
/**
 * A record of a processed command, stored by the {@link IdempotencyStore}.
 */
interface IdempotencyRecord {
  /** The unique command identifier that was processed. */
  commandId: ID;
  /** The aggregate type that processed the command. */
  aggregateName: string;
  /** The aggregate instance that processed the command. */
  aggregateId: ID;
  /** ISO 8601 timestamp of when the command was processed. */
  processedAt: string;
}

/**
 * Storage interface for tracking processed commands.
 * Used by the domain engine to detect and skip duplicate commands.
 *
 * Implementations must support save-then-exists round-trips and
 * TTL-based cleanup of expired records.
 */
interface IdempotencyStore {
  /**
   * Checks whether a command with the given ID has already been processed.
   * Returns `true` if a record exists (and has not expired), `false` otherwise.
   */
  exists(commandId: ID): Promise<boolean>;

  /**
   * Records that a command has been processed. Called within the UoW
   * to ensure atomicity with event persistence.
   * If a record with the same `commandId` already exists, it is overwritten.
   */
  save(record: IdempotencyRecord): Promise<void>;

  /**
   * Removes a single idempotency record. No-op if the record does not exist.
   */
  remove(commandId: ID): Promise<void>;

  /**
   * Removes all records whose `processedAt` timestamp is older than
   * `Date.now() - ttlMs`. Returns successfully even if no records
   * were removed.
   */
  removeExpired(ttlMs: number): Promise<void>;
}
```

## Behavioral Requirements

1. `exists(commandId)` returns `false` for a `commandId` that has never been saved.
2. `exists(commandId)` returns `true` for a `commandId` that has been saved and has not expired.
3. `save(record)` persists the idempotency record. Calling `save` with a `commandId` that already exists overwrites the record (last-write-wins).
4. `remove(commandId)` deletes the record for the given `commandId`. It is a no-op if the record does not exist.
5. `removeExpired(ttlMs)` removes all records whose `processedAt` is older than `Date.now() - ttlMs`. Records at exactly the boundary are removed.
6. `commandId` uniqueness is global — idempotency is not scoped to a specific aggregate name or instance.

## Invariants

- `IdempotencyRecord.processedAt` is always a valid ISO 8601 timestamp string.
- `IdempotencyRecord.commandId` uniquely identifies a command processing attempt.
- The store does not validate the format of `commandId` — any `ID` value is accepted.
- After `save(record)` completes, `exists(record.commandId)` must return `true` (assuming no TTL expiry).
- After `remove(commandId)` completes, `exists(commandId)` must return `false`.

## Edge Cases

- `exists()` for a never-saved `commandId` returns `false`.
- `remove()` for a non-existent `commandId` is a no-op (does not throw).
- `removeExpired(0)` removes all records (every record is older than now).
- `save()` with the same `commandId` twice overwrites the first record.
- All `ID` types (`string`, `number`, `bigint`) are valid as `commandId`.

## Integration Points

- `IdempotencyStore` is consumed by the `Domain` class during `executeAggregateCommand()`.
- `IdempotencyStore.save()` is enlisted in the same `UnitOfWork` as event persistence, ensuring atomicity.
- `IdempotencyStore.exists()` is called before the concurrency strategy, avoiding unnecessary locks and aggregate loads for duplicate commands.
- `IdempotencyRecord.commandId` corresponds to `Command.commandId`.

## Test Scenarios

### IdempotencyRecord and IdempotencyStore type shapes

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { IdempotencyRecord, IdempotencyStore, ID } from "@noddde/core";

describe("IdempotencyRecord", () => {
  it("should have commandId of type ID", () => {
    expectTypeOf<IdempotencyRecord["commandId"]>().toEqualTypeOf<ID>();
  });

  it("should have aggregateName of type string", () => {
    expectTypeOf<IdempotencyRecord["aggregateName"]>().toBeString();
  });

  it("should have aggregateId of type ID", () => {
    expectTypeOf<IdempotencyRecord["aggregateId"]>().toEqualTypeOf<ID>();
  });

  it("should have processedAt of type string", () => {
    expectTypeOf<IdempotencyRecord["processedAt"]>().toBeString();
  });
});

describe("IdempotencyStore", () => {
  it("should have exists returning Promise<boolean>", () => {
    expectTypeOf<IdempotencyStore["exists"]>().toBeFunction();
    expectTypeOf<ReturnType<IdempotencyStore["exists"]>>().toEqualTypeOf<
      Promise<boolean>
    >();
  });

  it("should have save returning Promise<void>", () => {
    expectTypeOf<IdempotencyStore["save"]>().toBeFunction();
    expectTypeOf<ReturnType<IdempotencyStore["save"]>>().toEqualTypeOf<
      Promise<void>
    >();
  });

  it("should have remove returning Promise<void>", () => {
    expectTypeOf<IdempotencyStore["remove"]>().toBeFunction();
    expectTypeOf<ReturnType<IdempotencyStore["remove"]>>().toEqualTypeOf<
      Promise<void>
    >();
  });

  it("should have removeExpired returning Promise<void>", () => {
    expectTypeOf<IdempotencyStore["removeExpired"]>().toBeFunction();
    expectTypeOf<ReturnType<IdempotencyStore["removeExpired"]>>().toEqualTypeOf<
      Promise<void>
    >();
  });
});
```
