---
title: "InMemoryIdempotencyStore"
module: engine/implementations/in-memory-idempotency-store
source_file: packages/engine/src/implementations/in-memory-idempotency-store.ts
status: implemented
exports: [InMemoryIdempotencyStore]
depends_on: [persistence/idempotency]
docs:
  - running/idempotent-commands.mdx
---

# InMemoryIdempotencyStore

> In-memory implementation of `IdempotencyStore` that stores processed command records in a `Map`. Records are lost when the process exits. Supports optional TTL-based lazy cleanup in `exists()` when a `ttlMs` is provided at construction time. Suitable for development, testing, and prototyping.

## Type Contract

```ts
/**
 * In-memory IdempotencyStore implementation that stores processed command
 * records in a Map. Records are keyed by `String(commandId)` to normalize
 * the ID union type to string map keys.
 *
 * When constructed with a `ttlMs`, the `exists()` method performs lazy
 * cleanup: if the record has expired, it is deleted and `false` is returned.
 * Without `ttlMs`, records never auto-expire from `exists()`.
 */
class InMemoryIdempotencyStore implements IdempotencyStore {
  constructor(ttlMs?: number);
  exists(commandId: ID): Promise<boolean>;
  save(record: IdempotencyRecord): Promise<void>;
  remove(commandId: ID): Promise<void>;
  removeExpired(ttlMs: number): Promise<void>;
}
```

## Behavioral Requirements

1. Implements all `IdempotencyStore` methods.
2. Uses `Map<string, IdempotencyRecord>` internally, keyed by `String(commandId)`.
3. `exists(commandId)` returns `true` if a record exists for the normalized key and has not expired (per constructor `ttlMs`).
4. When constructed with `ttlMs`, `exists()` performs lazy cleanup: checks the record's `processedAt` timestamp against `Date.now() - ttlMs`. If expired, deletes the record and returns `false`.
5. When constructed without `ttlMs`, records never auto-expire from `exists()` — they persist until explicitly removed.
6. `save(record)` stores the record under `String(record.commandId)`. Overwrites any existing record with the same key.
7. `remove(commandId)` deletes the record under `String(commandId)`. No-op if the key does not exist.
8. `removeExpired(ttlMs)` iterates all records and removes those whose `processedAt` is older than `Date.now() - ttlMs`. The `ttlMs` parameter is independent of the constructor `ttlMs`.

## Invariants

- Purely in-memory, no I/O. All methods are synchronous in nature but return `Promise` to satisfy the interface.
- Single-process safe. Not thread-safe for worker threads (no shared memory).
- `String(commandId)` normalization ensures `number`, `bigint`, and `string` ID types all produce valid map keys. `String(42)` → `"42"`, `String(42n)` → `"42"`, `String("cmd-1")` → `"cmd-1"`.

## Edge Cases

- `exists()` with lazy TTL: a record saved 1 second ago with `ttlMs = 500` is expired and returns `false`.
- `String(commandId)` normalization: `commandId = 42` (number) and `commandId = "42"` (string) map to the same key. This is acceptable — `commandId` values should be globally unique in practice.
- `removeExpired(0)` removes all records.
- Empty store: all methods are safe on an empty `Map`.

## Integration Points

- Implements `IdempotencyStore` from `@noddde/core`.
- Used by `Domain` when configured via `DomainConfiguration.infrastructure.idempotencyStore`.
- Follows the same `Map<string, T>` + composite key pattern as `InMemorySnapshotStore`, `InMemorySagaPersistence`, etc.

## Test Scenarios

### save and exists round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should return true for exists after save", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    expect(await store.exists("cmd-1")).toBe(true);
  });
});
```

### exists returns false for unknown commandId

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should return false for an unknown commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    expect(await store.exists("unknown")).toBe(false);
  });
});
```

### remove deletes the record

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should return false for exists after remove", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    await store.remove("cmd-1");
    expect(await store.exists("cmd-1")).toBe(false);
  });
});
```

### remove is no-op for non-existent commandId

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should not throw when removing a non-existent commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    await expect(store.remove("non-existent")).resolves.toBeUndefined();
  });
});
```

### removeExpired removes old records and keeps recent ones

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should remove expired records and keep recent ones", async () => {
    const store = new InMemoryIdempotencyStore();
    const now = Date.now();

    await store.save({
      commandId: "old-cmd",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date(now - 10_000).toISOString(), // 10s ago
    });

    await store.save({
      commandId: "recent-cmd",
      aggregateName: "Order",
      aggregateId: "order-2",
      processedAt: new Date(now).toISOString(), // now
    });

    await store.removeExpired(5_000); // TTL = 5s

    expect(await store.exists("old-cmd")).toBe(false);
    expect(await store.exists("recent-cmd")).toBe(true);
  });
});
```

### lazy TTL cleanup on exists when ttlMs is configured

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should return false and clean up expired record on exists when ttlMs is configured", async () => {
    const store = new InMemoryIdempotencyStore(100); // 100ms TTL

    await store.save({
      commandId: "cmd-1",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date(Date.now() - 200).toISOString(), // 200ms ago, expired
    });

    expect(await store.exists("cmd-1")).toBe(false);
  });

  it("should return true for non-expired record when ttlMs is configured", async () => {
    const store = new InMemoryIdempotencyStore(10_000); // 10s TTL

    await store.save({
      commandId: "cmd-2",
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(), // just now
    });

    expect(await store.exists("cmd-2")).toBe(true);
  });
});
```

### supports numeric and bigint commandIds

```ts
import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "@noddde/engine";

describe("InMemoryIdempotencyStore", () => {
  it("should support number commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: 42,
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    expect(await store.exists(42)).toBe(true);
  });

  it("should support bigint commandId", async () => {
    const store = new InMemoryIdempotencyStore();

    await store.save({
      commandId: 9007199254740993n,
      aggregateName: "Order",
      aggregateId: "order-1",
      processedAt: new Date().toISOString(),
    });

    expect(await store.exists(9007199254740993n)).toBe(true);
  });
});
```
