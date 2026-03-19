---
title: "InMemoryAggregateLocker"
module: engine/implementations/in-memory-aggregate-locker
source_file: packages/engine/src/implementations/in-memory-aggregate-locker.ts
status: implemented
exports: [InMemoryAggregateLocker]
depends_on: [persistence]
docs:
  - running/persistence.mdx
---

# InMemoryAggregateLocker

> In-memory implementation of `AggregateLocker` using promise-based mutexes. Each aggregate instance key gets an independent FIFO lock queue. Suitable for single-process development and testing. For multi-process production, use database-backed advisory lockers (`DrizzleAdvisoryLocker`, `PrismaAdvisoryLocker`, `TypeORMAdvisoryLocker`).

## Type Contract

```ts
class InMemoryAggregateLocker implements AggregateLocker {
  acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void>;
  release(aggregateName: string, aggregateId: string): Promise<void>;
}
```

- Implements `AggregateLocker` from `@noddde/core`.
- Uses `Promise`-based APIs for consistency with database-backed implementations.
- Internal storage: `Map<string, { locked: boolean; queue: Waiter[] }>` keyed by `${aggregateName}:${aggregateId}`.

## Behavioral Requirements

1. **Acquire on unlocked key** -- `acquire(name, id)` returns immediately when the key is not locked. Sets the key to locked.
2. **Acquire on locked key blocks** -- When the key is already locked, `acquire` returns a Promise that resolves when the previous holder calls `release`. The caller is enqueued in a FIFO queue.
3. **Timeout throws LockTimeoutError** -- If `timeoutMs > 0` and the lock is not acquired within the timeout, the waiter is removed from the queue and the Promise rejects with `LockTimeoutError`. The timeout timer is cleared on successful acquisition.
4. **Release transfers to next waiter** -- When `release` is called and waiters are queued, the first waiter is dequeued and its Promise resolves. The lock stays held (ownership transferred).
5. **Release on empty queue unlocks** -- When `release` is called with no waiters queued, the key is set to unlocked.
6. **Release is idempotent** -- Calling `release` on an already-unlocked key is a no-op.
7. **FIFO ordering** -- Waiters acquire the lock in the order they called `acquire`. The first caller in the queue gets the lock first.
8. **Key isolation** -- Locks for `("Order", "1")` and `("Account", "1")` are completely independent. Acquiring one does not block the other.

## Invariants

- Purely in-memory. No filesystem, database, or network I/O.
- Single-process only. Not safe for multi-process or worker thread concurrency.
- The Map entry is created lazily on first `acquire` for a given key.

## Edge Cases

- **Acquire with timeoutMs=0** -- Equivalent to no timeout (blocks indefinitely).
- **Multiple concurrent acquires on same key** -- All block in FIFO order. Each release dequeues exactly one waiter.
- **Release without prior acquire** -- No-op (idempotent).
- **Timeout fires after release** -- If release resolves the waiter before the timeout fires, the timeout timer is cleared. No spurious `LockTimeoutError`.

## Integration Points

- **DomainConfiguration.infrastructure.aggregateConcurrency** -- Provided as the `locker` field when `strategy` is `"pessimistic"`.
- **PessimisticConcurrencyStrategy** -- Calls `acquire` before the command lifecycle and `release` in a `finally` block.

## Test Scenarios

### acquire and release on a single key works without blocking

```ts
import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("should acquire and release without blocking on an unlocked key", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Account", "acc-1");
    await locker.release("Account", "acc-1");

    // Should be able to acquire again after release
    await locker.acquire("Account", "acc-1");
    await locker.release("Account", "acc-1");
  });
});
```

### second acquire on same key blocks until first release

```ts
import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("should block second acquire until first release", async () => {
    const locker = new InMemoryAggregateLocker();
    const order: string[] = [];

    await locker.acquire("Account", "acc-1");
    order.push("first-acquired");

    const secondAcquire = locker.acquire("Account", "acc-1").then(() => {
      order.push("second-acquired");
    });

    // Second acquire should be blocked
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["first-acquired"]);

    await locker.release("Account", "acc-1");
    await secondAcquire;
    expect(order).toEqual(["first-acquired", "second-acquired"]);

    await locker.release("Account", "acc-1");
  });
});
```

### timeout throws LockTimeoutError

```ts
import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker, LockTimeoutError } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("should throw LockTimeoutError when timeout expires", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Account", "acc-1");

    await expect(locker.acquire("Account", "acc-1", 100)).rejects.toThrow(
      LockTimeoutError,
    );

    await locker.release("Account", "acc-1");
  });
});
```

### release is idempotent

```ts
import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("should not throw when releasing an already-released lock", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.release("Account", "acc-1");
    await locker.release("Account", "acc-1");
  });
});
```

### different keys do not interfere

```ts
import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("should allow concurrent locks on different keys", async () => {
    const locker = new InMemoryAggregateLocker();

    await locker.acquire("Order", "1");
    await locker.acquire("Account", "1"); // Should not block

    await locker.release("Order", "1");
    await locker.release("Account", "1");
  });
});
```

### FIFO ordering

```ts
import { describe, it, expect } from "vitest";
import { InMemoryAggregateLocker } from "@noddde/core";

describe("InMemoryAggregateLocker", () => {
  it("should grant lock to waiters in FIFO order", async () => {
    const locker = new InMemoryAggregateLocker();
    const order: number[] = [];

    await locker.acquire("Account", "acc-1");

    const waiter1 = locker.acquire("Account", "acc-1").then(() => {
      order.push(1);
    });
    const waiter2 = locker.acquire("Account", "acc-1").then(() => {
      order.push(2);
    });

    await locker.release("Account", "acc-1");
    await waiter1;
    await locker.release("Account", "acc-1");
    await waiter2;
    await locker.release("Account", "acc-1");

    expect(order).toEqual([1, 2]);
  });
});
```
