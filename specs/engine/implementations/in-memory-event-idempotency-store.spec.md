---
title: "InMemoryEventIdempotencyStore"
module: engine/implementations/in-memory-event-idempotency-store
source_file: packages/engine/src/implementations/in-memory-event-idempotency-store.ts
status: implemented
exports: [InMemoryEventIdempotencyStore]
depends_on: [edd/event-idempotency]
docs:
  - events/event-handlers.mdx
---

# InMemoryEventIdempotencyStore

> In-memory implementation of `EventIdempotencyStore` (see `core/edd/event-idempotency`) that stores processed dedup keys in a `Map`. Records are lost when the process exits. Supports optional TTL-based lazy cleanup in `hasProcessed()` when a `ttlMs` is provided at construction time. Suitable for development, testing, and single-process prototyping — not for multi-instance deployments (dedup state isn't shared across processes).

## Type Contract

```ts
import type { EventIdempotencyStore } from "@noddde/core";

/**
 * In-memory EventIdempotencyStore implementation that stores processed
 * dedup keys in a Map with their processed timestamp.
 *
 * When constructed with a `ttlMs`, `hasProcessed()` performs lazy cleanup:
 * if the record has expired, it is deleted and `false` is returned.
 * Without `ttlMs`, records never auto-expire from `hasProcessed()`.
 */
export class InMemoryEventIdempotencyStore implements EventIdempotencyStore {
  /**
   * @param ttlMs - Optional time-to-live in milliseconds. When set,
   *   `hasProcessed()` performs lazy cleanup of expired records.
   */
  constructor(ttlMs?: number);
  hasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  removeExpired(ttlMs: number): Promise<void>;
}
```

## Behavioral Requirements

1. Implements all `EventIdempotencyStore` methods.
2. Uses a `Map<string, number>` internally, keyed by the dedup key string, valued by the `markProcessed()` call's timestamp (`Date.now()`).
3. `hasProcessed(key)` returns `true` if a record exists for `key` and has not expired (per constructor `ttlMs`), `false` otherwise.
4. When constructed with `ttlMs`, `hasProcessed()` performs lazy cleanup: if `Date.now() - recordedAt > ttlMs`, the record is deleted and `false` is returned.
5. When constructed without `ttlMs`, records never auto-expire from `hasProcessed()` — they persist until explicitly removed via `removeExpired`.
6. `markProcessed(key)` stores `Date.now()` under `key`. Calling it twice for the same key overwrites the timestamp (last-write-wins); both calls leave `hasProcessed(key)` returning `true`.
7. `removeExpired(ttlMs)` iterates all records and removes those recorded more than `ttlMs` milliseconds ago. The `ttlMs` parameter is independent of the constructor `ttlMs`.

## Invariants

- Purely in-memory, no I/O. All methods are synchronous in nature but return `Promise` to satisfy the interface.
- Single-process safe. Dedup state is not shared across processes or restarts — matches other in-memory implementations in this package (`InMemoryIdempotencyStore`, `InMemorySnapshotStore`, etc.) which are explicitly documented as dev/test-only.
- After `markProcessed(key)` resolves, `hasProcessed(key)` resolves `true` (assuming no TTL expiry in between).
- After `removeExpired(ttlMs)` removes a key, `hasProcessed(key)` resolves `false` for that key.

## Edge Cases

- `hasProcessed()` with lazy TTL: a key marked processed 1 second ago with constructor `ttlMs = 500` is expired and returns `false`, and the record is deleted as a side effect.
- `removeExpired(0)` removes all records (every record is at least 0ms old).
- Empty store: all methods are safe on an empty `Map`.
- Marking the same key processed twice does not throw and does not create duplicate entries.

## Integration Points

- Implements `EventIdempotencyStore` from `@noddde/core`.
- Intended for use with `withIdempotency(handler, store)` from `@noddde/core` — see `core/edd/event-idempotency`.
- Follows the same `Map<string, T>` + lazy-TTL pattern as `InMemoryIdempotencyStore`, but is a distinct class for a distinct concern (event handler redelivery dedup vs. command dispatch dedup).
- For durable, multi-instance-safe storage, use `TypeORMEventIdempotencyStore`, `DrizzleEventIdempotencyStore`, or `PrismaEventIdempotencyStore` from the corresponding adapter package instead.

## Test Scenarios

### markProcessed and hasProcessed round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventIdempotencyStore } from "@noddde/engine";

describe("InMemoryEventIdempotencyStore", () => {
  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new InMemoryEventIdempotencyStore();

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });
});
```

### hasProcessed returns false for an unknown key

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventIdempotencyStore } from "@noddde/engine";

describe("InMemoryEventIdempotencyStore", () => {
  it("should return false for a key that was never marked processed", async () => {
    const store = new InMemoryEventIdempotencyStore();

    expect(await store.hasProcessed("unknown")).toBe(false);
  });
});
```

### markProcessed is idempotent

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventIdempotencyStore } from "@noddde/engine";

describe("InMemoryEventIdempotencyStore", () => {
  it("should not throw and should keep hasProcessed true when marking the same key twice", async () => {
    const store = new InMemoryEventIdempotencyStore();

    await store.markProcessed("evt-1");
    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });
});
```

### removeExpired removes old records and keeps recent ones

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryEventIdempotencyStore } from "@noddde/engine";

describe("InMemoryEventIdempotencyStore", () => {
  it("should remove expired records and keep recent ones", async () => {
    const store = new InMemoryEventIdempotencyStore();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await store.markProcessed("old-evt");

    vi.spyOn(Date, "now").mockReturnValue(1_010_000); // 10s later
    await store.markProcessed("recent-evt");

    await store.removeExpired(5_000); // TTL = 5s, evaluated at "now" = 1_010_000

    expect(await store.hasProcessed("old-evt")).toBe(false);
    expect(await store.hasProcessed("recent-evt")).toBe(true);

    vi.restoreAllMocks();
  });
});
```

### lazy TTL cleanup on hasProcessed when constructor ttlMs is configured

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryEventIdempotencyStore } from "@noddde/engine";

describe("InMemoryEventIdempotencyStore", () => {
  it("should return false and clean up an expired record on hasProcessed", async () => {
    const store = new InMemoryEventIdempotencyStore(100); // 100ms TTL

    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await store.markProcessed("evt-1");

    vi.spyOn(Date, "now").mockReturnValue(1_000_200); // 200ms later, expired
    expect(await store.hasProcessed("evt-1")).toBe(false);

    vi.restoreAllMocks();
  });

  it("should return true for a non-expired record when ttlMs is configured", async () => {
    const store = new InMemoryEventIdempotencyStore(10_000); // 10s TTL

    await store.markProcessed("evt-2");

    expect(await store.hasProcessed("evt-2")).toBe(true);
  });
});
```
