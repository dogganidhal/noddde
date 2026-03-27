---
title: "UnitOfWork Interface & UnitOfWorkFactory"
module: persistence/unit-of-work
source_file: packages/core/src/persistence/unit-of-work.ts
status: implemented
exports:
  - UnitOfWork
  - UnitOfWorkFactory
depends_on:
  - edd/event
docs:
  - domain-configuration/unit-of-work.mdx
---

# UnitOfWork Interface & UnitOfWorkFactory

> Defines the unit of work boundary for write model operations. A `UnitOfWork` buffers persistence operations and defers event publishing until `commit()`, ensuring atomicity within a single business operation. The `UnitOfWorkFactory` type enables pluggable implementations (in-memory, database-backed). The Domain engine uses this interface internally for every command dispatch and saga reaction, and exposes it to developers via `domain.withUnitOfWork()` for explicit multi-command units of work.

## Type Contract

```ts
import type { Event } from "../edd";

/**
 * Coordinates atomic persistence and deferred event publishing
 * within a write model unit of work.
 *
 * A UnitOfWork collects write operations via {@link enlist} and events
 * via {@link deferPublish}, then executes all operations atomically
 * when {@link commit} is called. Events are returned by `commit()`
 * for the caller (typically the Domain) to publish after persistence
 * succeeds.
 *
 * A UnitOfWork is single-use: after {@link commit} or {@link rollback},
 * any further call throws an error.
 */
interface UnitOfWork {
  /**
   * Buffers a write operation for deferred execution.
   * Operations are executed in enlistment order when `commit()` is called.
   *
   * @param operation - An async thunk wrapping a persistence call
   *   (e.g., `() => persistence.save(name, id, events)`).
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   */
  enlist(operation: () => Promise<void>): void;

  /**
   * Schedules events for deferred publishing after successful commit.
   * Events accumulate across multiple calls in the order they are deferred.
   *
   * @param events - One or more domain events to publish after commit.
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   */
  deferPublish(...events: Event[]): void;

  /**
   * Executes all enlisted operations in enlistment order, then returns
   * all deferred events. The caller is responsible for publishing the
   * returned events (typically via `EventBus.dispatch()`).
   *
   * After `commit()`, the UnitOfWork is sealed — further calls to
   * `enlist`, `deferPublish`, `commit`, or `rollback` will throw.
   *
   * @returns The accumulated deferred events, in the order they were scheduled.
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   * @throws Error if any enlisted operation fails (partial commit may occur
   *   in the in-memory implementation; database-backed implementations
   *   should use real database transactions for all-or-nothing semantics).
   */
  commit(): Promise<Event[]>;

  /**
   * Discards all enlisted operations and deferred events without
   * executing any operations.
   *
   * After `rollback()`, the UnitOfWork is sealed — further calls throw.
   *
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   */
  rollback(): Promise<void>;
}

/**
 * Factory function that creates a new {@link UnitOfWork} instance.
 * Called once per unit of work boundary (per command dispatch, saga reaction,
 * or explicit `domain.withUnitOfWork()` call).
 *
 * Configured via `DomainWiring.unitOfWork`.
 */
type UnitOfWorkFactory = () => UnitOfWork;
```

- `commit()` returns `Event[]` rather than `void` so the UnitOfWork stays completely decoupled from the `EventBus`. The Domain is responsible for publishing events after commit succeeds.
- `enlist()` accepts `() => Promise<void>` thunks rather than typed persistence calls. This keeps the interface generic — any storage backend (PostgreSQL, DynamoDB, EventStoreDB) can wrap its writes as thunks and enlist them.
- `UnitOfWorkFactory` is a simple function type, not a class or interface. This follows the framework's functional-first style.

## Behavioral Requirements

1. **enlist stores operations for deferred execution** — `enlist(operation)` buffers the operation without executing it. The operation is only executed when `commit()` is called.
2. **deferPublish accumulates events** — `deferPublish(...events)` appends events to an internal list. Multiple calls accumulate events in call order.
3. **commit executes operations in enlistment order** — `commit()` runs each enlisted operation sequentially (awaiting each), in the order they were enlisted. After all operations succeed, it returns the accumulated deferred events.
4. **commit returns deferred events in scheduling order** — The `Event[]` returned by `commit()` preserves the order events were passed to `deferPublish`.
5. **rollback discards everything without executing** — `rollback()` clears all enlisted operations and deferred events. No operations are executed.
6. **Single-use lifecycle** — After `commit()` or `rollback()`, the UnitOfWork is sealed. Any subsequent call to `enlist`, `deferPublish`, `commit`, or `rollback` must throw an error.
7. **UnitOfWorkFactory creates independent instances** — Each call to the factory must return a new, independent UnitOfWork instance with no shared state.

## Invariants

- A UnitOfWork is always in one of two states: **active** (accepting operations) or **completed** (sealed after commit/rollback). There is no way to return to the active state.
- Operations enlisted in a UnitOfWork are never executed before `commit()` is called.
- `rollback()` never executes any enlisted operations, regardless of when it is called.
- The order of operations is always preserved: first-enlisted executes first.
- The order of deferred events is always preserved: first-deferred appears first in the returned array.

## Edge Cases

- **commit with no enlisted operations** — Succeeds and returns an empty array (or the deferred events if any were scheduled without persistence operations).
- **deferPublish with no events** — `deferPublish()` with zero arguments is a no-op.
- **deferPublish with empty event properties** — Events are stored as-is; the UoW does not validate event contents.
- **double commit** — Second `commit()` throws "UnitOfWork already completed" (or similar).
- **rollback after commit** — Throws "UnitOfWork already completed".
- **enlist after rollback** — Throws "UnitOfWork already completed".
- **commit when an enlisted operation throws** — The error propagates from `commit()`. The UoW transitions to completed state regardless (preventing re-commit of a partially-executed batch). Events are NOT returned.

## Integration Points

- **DomainWiring.unitOfWork** — Optional factory function. If not provided, the Domain defaults to `createInMemoryUnitOfWork` from `@noddde/engine`.
- **Domain.executeAggregateCommand()** — Creates or reuses a UoW for each command execution. Enlists persistence operations and defers events.
- **Domain.executeSagaHandler()** — Creates a UoW that spans saga state persistence + all commands dispatched by the saga reaction.
- **Domain.withUnitOfWork()** — Creates a UoW for explicit multi-command units of work. All commands dispatched within the callback share the same UoW.
- **InMemoryUnitOfWork** — The default in-memory implementation provided by `@noddde/engine`.

## Test Scenarios

### UnitOfWork interface has the correct shape

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { UnitOfWork, UnitOfWorkFactory, Event } from "@noddde/core";

describe("UnitOfWork Interface", () => {
  it("should have enlist accepting an async thunk", () => {
    expectTypeOf<UnitOfWork["enlist"]>().toBeFunction();
    expectTypeOf<UnitOfWork["enlist"]>()
      .parameter(0)
      .toMatchTypeOf<() => Promise<void>>();
  });

  it("should have deferPublish accepting spread events", () => {
    expectTypeOf<UnitOfWork["deferPublish"]>().toBeFunction();
    expectTypeOf<UnitOfWork["deferPublish"]>().parameters.toMatchTypeOf<
      Event[]
    >();
  });

  it("should have commit returning Promise of Event array", () => {
    expectTypeOf<UnitOfWork["commit"]>().toBeFunction();
    expectTypeOf<UnitOfWork["commit"]>().returns.toMatchTypeOf<
      Promise<Event[]>
    >();
  });

  it("should have rollback returning Promise of void", () => {
    expectTypeOf<UnitOfWork["rollback"]>().toBeFunction();
    expectTypeOf<UnitOfWork["rollback"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});
```

### UnitOfWorkFactory is a function returning UnitOfWork

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { UnitOfWork, UnitOfWorkFactory } from "@noddde/core";

describe("UnitOfWorkFactory", () => {
  it("should be a function returning a UnitOfWork", () => {
    expectTypeOf<UnitOfWorkFactory>().toBeFunction();
    expectTypeOf<UnitOfWorkFactory>().returns.toMatchTypeOf<UnitOfWork>();
  });
});
```
