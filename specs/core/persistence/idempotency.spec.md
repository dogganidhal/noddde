---
title: "IdempotencyStore & IdempotencyRecord"
module: persistence/idempotency
source_file: packages/core/src/persistence/idempotency.ts
status: implemented
exports: [IdempotencyRecord, IdempotencyStore, IdempotencyConflictError]
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
   * Fast-path only — the authoritative duplicate signal is a conflict thrown
   * from `save()`.
   */
  exists(commandId: ID): Promise<boolean>;

  /**
   * Atomically claims a command as processed. Called within the UoW
   * to ensure atomicity with event persistence.
   * Throws {@link IdempotencyConflictError} if a (non-expired) record with
   * the same `commandId` already exists.
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

/**
 * Thrown by {@link IdempotencyStore.save} when a record for the given
 * `commandId` already exists — the atomic duplicate signal.
 */
class IdempotencyConflictError extends Error {
  readonly name: "IdempotencyConflictError";
  readonly commandId: ID;
  constructor(commandId: ID);
}
```

## Behavioral Requirements

1. `exists(commandId)` returns `false` for a `commandId` that has never been saved.
2. `exists(commandId)` returns `true` for a `commandId` that has been saved and has not expired.
3. `save(record)` atomically claims the `commandId`. Calling `save` with a `commandId` for which a live (non-expired) record already exists throws `IdempotencyConflictError` instead of overwriting.
4. `remove(commandId)` deletes the record for the given `commandId`. It is a no-op if the record does not exist.
5. `removeExpired(ttlMs)` removes all records whose `processedAt` is older than `Date.now() - ttlMs`. Records at exactly the boundary are removed.
6. `commandId` uniqueness is global — idempotency is not scoped to a specific aggregate name or instance.
7. `save(record)` for a `commandId` whose only existing record has already expired (per TTL) succeeds and replaces it — expiry means the record is no longer "live" for conflict purposes.

## Invariants

- `IdempotencyRecord.processedAt` is always a valid ISO 8601 timestamp string.
- `IdempotencyRecord.commandId` uniquely identifies a command processing attempt.
- The store does not validate the format of `commandId` — any `ID` value is accepted.
- After `save(record)` completes, `exists(record.commandId)` must return `true` (assuming no TTL expiry).
- After `remove(commandId)` completes, `exists(commandId)` must return `false`.
- `save()` never silently overwrites a live record — a duplicate `commandId` always surfaces as a thrown `IdempotencyConflictError`, never a swallowed write.

## Edge Cases

- `exists()` for a never-saved `commandId` returns `false`.
- `remove()` for a non-existent `commandId` is a no-op (does not throw).
- `removeExpired(0)` removes all records (every record is older than now).
- `save()` with the same `commandId` twice, while the first record is still live, throws `IdempotencyConflictError` on the second call.
- `save()` with the same `commandId` twice, where the first record has expired per `ttlMs`, succeeds and replaces the expired record.
- All `ID` types (`string`, `number`, `bigint`) are valid as `commandId`.

## Integration Points

- `IdempotencyStore` is consumed by the `Domain` class during `executeAggregateCommand()`.
- `IdempotencyStore.save()` is enlisted in the same `UnitOfWork` as event persistence for aggregate commands, so a commit-time `IdempotencyConflictError` rolls back the UoW and the events are never published — the transactional (exactly-once-ish) duplicate guarantee. Standalone commands have no such transactional boundary and get best-effort dedup only; see `specs/api-freeze.spec.md` decision 5.
- `IdempotencyStore.exists()` is called before the concurrency strategy, avoiding unnecessary locks and aggregate loads for duplicate commands. It remains a fast-path only — `IdempotencyConflictError` from `save()` is authoritative.
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

### IdempotencyConflictError: properties and inheritance

```ts
import { describe, it, expect } from "vitest";
import { IdempotencyConflictError } from "@noddde/core";

describe("IdempotencyConflictError", () => {
  it("should have correct name, message, and commandId property", () => {
    const error = new IdempotencyConflictError("cmd-1");
    expect(error.name).toBe("IdempotencyConflictError");
    expect(error.commandId).toBe("cmd-1");
    expect(error.message).toContain("cmd-1");
  });

  it("should be an instance of Error", () => {
    const error = new IdempotencyConflictError("cmd-1");
    expect(error).toBeInstanceOf(Error);
  });
});
```

### InMemoryIdempotencyStore: save throws IdempotencyConflictError on duplicate commandId

```ts
import { describe, it, expect } from "vitest";
import { IdempotencyConflictError } from "@noddde/core";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore conflict detection", () => {
  it("should throw IdempotencyConflictError when saving a commandId that already exists", async () => {
    const store = new InMemoryIdempotencyStore();
    const record = {
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    };

    await store.save(record);

    await expect(store.save(record)).rejects.toThrow(IdempotencyConflictError);
  });

  it("should allow re-saving a commandId after its record expired", async () => {
    const store = new InMemoryIdempotencyStore(100);

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date(Date.now() - 200).toISOString(),
    });

    await expect(
      store.save({
        commandId: "cmd-1",
        aggregateName: "Order",
        aggregateId: "order-1",
        processedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
```
