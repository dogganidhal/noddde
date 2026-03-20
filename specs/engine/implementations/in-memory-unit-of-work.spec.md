---
title: "InMemoryUnitOfWork"
module: engine/implementations/in-memory-unit-of-work
source_file: packages/engine/src/implementations/in-memory-unit-of-work.ts
status: implemented
exports:
  - InMemoryUnitOfWork
  - createInMemoryUnitOfWork
depends_on:
  - persistence/unit-of-work
docs:
  - domain-configuration/unit-of-work.mdx
---

# InMemoryUnitOfWork

> In-memory implementation of the `UnitOfWork` interface. Buffers persistence operations as thunks and deferred events in arrays. On `commit()`, executes all operations sequentially and returns all deferred events. On `rollback()`, discards everything. This implementation is the default used by the Domain when no custom `unitOfWorkFactory` is provided.

## Type Contract

```ts
import type { Event, UnitOfWork, UnitOfWorkFactory } from "@noddde/core";

/**
 * In-memory implementation of {@link UnitOfWork}.
 *
 * Suitable for development, testing, and single-process applications.
 * For production use with durable storage, provide a custom
 * `UnitOfWorkFactory` backed by your database's unit of work mechanism.
 */
class InMemoryUnitOfWork implements UnitOfWork {
  enlist(operation: () => Promise<void>): void;
  deferPublish(...events: Event[]): void;
  commit(): Promise<Event[]>;
  rollback(): Promise<void>;
}

/**
 * Factory function that creates a new {@link InMemoryUnitOfWork} instance.
 * Matches the {@link UnitOfWorkFactory} type and can be used as the
 * default value for `DomainConfiguration.infrastructure.unitOfWorkFactory`.
 */
const createInMemoryUnitOfWork: UnitOfWorkFactory;
```

- `InMemoryUnitOfWork` is a class (following the pattern of other engine implementations like `InMemoryCommandBus`, `InMemoryEventSourcedAggregatePersistence`, etc.).
- `createInMemoryUnitOfWork` is a standalone factory function conforming to `UnitOfWorkFactory`.

## Behavioral Requirements

1. **enlist buffers operations without executing** — Calling `enlist(op)` stores `op` in an internal array. The operation is not invoked until `commit()`.
2. **deferPublish accumulates events** — Calling `deferPublish(e1, e2)` appends `e1` and `e2` to the pending events list. Multiple calls accumulate in order.
3. **commit executes operations in enlistment order** — `commit()` iterates through the operation array and `await`s each operation sequentially. If any operation throws, the error propagates and remaining operations are NOT executed.
4. **commit returns accumulated events** — After all operations succeed, `commit()` returns a copy of the accumulated deferred events array.
5. **commit marks the UoW as completed before executing** — The `completed` flag is set to `true` BEFORE executing any operation. This prevents re-entry or re-commit if an operation fails partway through.
6. **rollback discards without executing** — `rollback()` clears the internal operation and event arrays, sets `completed = true`, and returns immediately.
7. **completed state rejects all further calls** — After `commit()` or `rollback()`, calls to `enlist`, `deferPublish`, `commit`, or `rollback` throw an error with message "UnitOfWork already completed".
8. **createInMemoryUnitOfWork returns independent instances** — Each invocation returns a new `InMemoryUnitOfWork` with empty state.

## Invariants

- The internal operation array grows monotonically until commit or rollback clears it.
- The internal event array grows monotonically until commit or rollback clears it.
- Once `completed` is `true`, it never becomes `false`.
- Operations are always executed in FIFO order (first enlisted, first executed).
- Events are always returned in FIFO order (first deferred, first in array).

## Edge Cases

- **commit with zero operations and zero events** — Returns `[]`. No error.
- **commit with zero operations but some deferred events** — Returns the events without executing any operations.
- **commit with operations but no deferred events** — Executes operations, returns `[]`.
- **enlist after commit** — Throws "UnitOfWork already completed".
- **enlist after rollback** — Throws "UnitOfWork already completed".
- **commit after commit** — Throws "UnitOfWork already completed".
- **rollback after commit** — Throws "UnitOfWork already completed".
- **deferPublish with zero arguments** — No-op: no event added.
- **Operation throws during commit** — Error propagates. UoW is already marked completed. Events are NOT returned.

## Integration Points

- **`@noddde/core` persistence/unit-of-work** — Implements the `UnitOfWork` interface.
- **Domain.init()** — `createInMemoryUnitOfWork` is used as the default `UnitOfWorkFactory` when `DomainConfiguration.infrastructure.unitOfWorkFactory` is not provided.

## Test Scenarios

### enlist stores operations that commit executes in order

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should execute enlisted operations in order on commit", async () => {
    const uow = new InMemoryUnitOfWork();
    const log: string[] = [];

    uow.enlist(async () => {
      log.push("first");
    });
    uow.enlist(async () => {
      log.push("second");
    });
    uow.enlist(async () => {
      log.push("third");
    });

    await uow.commit();

    expect(log).toEqual(["first", "second", "third"]);
  });
});
```

### deferPublish accumulates events returned by commit

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should return deferred events on commit in order", async () => {
    const uow = new InMemoryUnitOfWork();

    uow.deferPublish({ name: "A", payload: { x: 1 } });
    uow.deferPublish(
      { name: "B", payload: { x: 2 } },
      { name: "C", payload: { x: 3 } },
    );

    const events = await uow.commit();

    expect(events).toEqual([
      { name: "A", payload: { x: 1 } },
      { name: "B", payload: { x: 2 } },
      { name: "C", payload: { x: 3 } },
    ]);
  });
});
```

### commit with no operations returns empty event array

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should return empty array when no events deferred", async () => {
    const uow = new InMemoryUnitOfWork();
    const events = await uow.commit();

    expect(events).toEqual([]);
  });
});
```

### rollback prevents operations from executing

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should not execute operations after rollback", async () => {
    const uow = new InMemoryUnitOfWork();
    let executed = false;

    uow.enlist(async () => {
      executed = true;
    });
    uow.deferPublish({ name: "E", payload: {} });

    await uow.rollback();

    expect(executed).toBe(false);
  });
});
```

### commit after commit throws

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should throw on double commit", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.commit();

    await expect(uow.commit()).rejects.toThrow("UnitOfWork already completed");
  });
});
```

### rollback after commit throws

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should throw on rollback after commit", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.commit();

    await expect(uow.rollback()).rejects.toThrow(
      "UnitOfWork already completed",
    );
  });
});
```

### enlist after commit throws

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should throw on enlist after commit", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.commit();

    expect(() => uow.enlist(async () => {})).toThrow(
      "UnitOfWork already completed",
    );
  });
});
```

### deferPublish after rollback throws

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should throw on deferPublish after rollback", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.rollback();

    expect(() => uow.deferPublish({ name: "E", payload: {} })).toThrow(
      "UnitOfWork already completed",
    );
  });
});
```

### createInMemoryUnitOfWork returns independent instances

```ts
import { describe, it, expect } from "vitest";
import { createInMemoryUnitOfWork } from "@noddde/engine";

describe("createInMemoryUnitOfWork", () => {
  it("should return independent UnitOfWork instances", async () => {
    const uow1 = createInMemoryUnitOfWork();
    const uow2 = createInMemoryUnitOfWork();

    uow1.deferPublish({ name: "A", payload: {} });

    const events1 = await uow1.commit();
    const events2 = await uow2.commit();

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(0);
  });
});
```

### commit propagates operation errors and seals the UoW

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUnitOfWork } from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should propagate error from a failing operation and seal the UoW", async () => {
    const uow = new InMemoryUnitOfWork();
    const log: string[] = [];

    uow.enlist(async () => {
      log.push("first");
    });
    uow.enlist(async () => {
      throw new Error("persistence failure");
    });
    uow.enlist(async () => {
      log.push("third");
    });
    uow.deferPublish({ name: "E", payload: {} });

    await expect(uow.commit()).rejects.toThrow("persistence failure");

    // First operation executed, second threw, third was skipped
    expect(log).toEqual(["first"]);

    // UoW is sealed after failed commit
    expect(() => uow.enlist(async () => {})).toThrow(
      "UnitOfWork already completed",
    );
  });
});
```
