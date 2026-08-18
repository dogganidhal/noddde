---
title: "InMemorySagaPersistence"
module: engine/implementations/in-memory-saga-persistence
source_file: packages/engine/src/implementations/in-memory-saga-persistence.ts
status: implemented
exports: [InMemorySagaPersistence]
depends_on: [engine/domain]
docs: [running/persistence.mdx]
---

# InMemorySagaPersistence

> In-memory SagaPersistence implementation that stores saga instance state alongside a monotonically increasing version in a Map, keyed by `(sagaName, sagaId)`. Data is lost when the process exits. Suitable for development, testing, and prototyping. Sagas use state-stored persistence (not event-sourced) because they track workflow progress, not domain truth. Uses the same optimistic-concurrency shape as `InMemoryStateStoredAggregatePersistence` (API Freeze decision 2, see `specs/api-freeze.spec.md`).

## Type Contract

```ts
class InMemorySagaPersistence implements SagaPersistence {
  load(
    sagaName: string,
    sagaId: ID,
  ): Promise<{ state: any; version: number } | null>;
  save(
    sagaName: string,
    sagaId: ID,
    state: any,
    expectedVersion: number,
  ): Promise<void>;
}
```

- Implements the `SagaPersistence` interface from `@noddde/core`.
- `load` returns `null` when no saga instance exists for the given key (version implicitly 0). The runtime uses this sentinel to determine whether a saga instance needs to be created (using `initialState`, version 0) or updated.
- `save` overwrites the entire state for the saga instance after an optimistic-concurrency check, throwing `ConcurrencyError` on a version mismatch — same protocol as `StateStoredAggregatePersistence`.

## Behavioral Requirements

1. **Save stores state snapshot** -- `save(sagaName, sagaId, state, expectedVersion)` persists the full state object for the `(sagaName, sagaId)` pair, replacing any previously stored state, after verifying `expectedVersion` matches the current stored version.
2. **Load returns stored state and version** -- `load(sagaName, sagaId)` returns `{ state, version }` for the most recently saved state for the given pair.
3. **Load returns null for new saga** -- If no state has been saved for `(sagaName, sagaId)`, `load` returns `null`. The runtime interprets this as "no saga instance exists, version 0" and uses `Saga.initialState` to bootstrap a new instance.
4. **Namespace isolation** -- State for `("OrderFulfillment", "order-1")` and `("PaymentReconciliation", "order-1")` are stored independently. The saga name acts as a namespace, just like aggregate name in aggregate persistence.
5. **Overwrite semantics** -- Each successful `save` replaces the previous state entirely and increments the version by 1. There is no merge or diff.
6. **Optimistic concurrency** -- `save` throws `ConcurrencyError` (imported from `@noddde/core`) when `expectedVersion` does not match the actual stored version (0 for a new instance). This detects — but does not itself resolve — the lost-update race where two events for the same saga instance are processed concurrently (GA audit issue #132); resolving it (retry/serialize) is the saga executor's responsibility.

## Invariants

- Purely in-memory. No filesystem, database, or network I/O.
- Supports arbitrary saga names and IDs (`ID` — `string | number | bigint`).
- No validation on the stored state. The runtime is responsible for providing well-formed state.
- Single-process only. Not safe for sharing across worker threads.
- The version is a monotonically increasing integer starting at 0. Each successful `save()` increments it by 1, exactly mirroring `InMemoryStateStoredAggregatePersistence`.

## Edge Cases

- **Save then load returns exact state and version** -- The stored and loaded `{ state, version }` should be structurally equal.
- **Multiple saga instances of the same type** -- `("OrderFulfillment", "order-1")` and `("OrderFulfillment", "order-2")` are independent entries with independent version counters.
- **Rapid save/load cycles** -- Each save immediately updates the store. A subsequent load always reflects the latest save and version.
- **Load before any save** -- Returns `null`.
- **Stale expectedVersion** -- `save` with an `expectedVersion` that doesn't match the stored version throws `ConcurrencyError` and does not modify the store.

## Integration Points

- **Domain.init()** -- The domain receives the saga persistence instance from `DomainWiring.sagas.persistence`.
- **Saga event handling lifecycle** -- When an event arrives for a saga: (1) derive the saga instance ID via `saga.on[event.name].id(event)`, (2) `load(sagaName, sagaId)` to get `{state, version}` or `null`, (3) if `null` and event is in `saga.startedBy`, use `saga.initialState` at version 0, (4) invoke the handler via `saga.on[event.name].handle(event, state, infrastructure)`, (5) `save(sagaName, sagaId, reaction.state, version)`, retrying or serializing on `ConcurrencyError`, (6) dispatch `reaction.commands`.

## Test Scenarios

### save and load round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should store and retrieve saga state and version", async () => {
    const persistence = new InMemorySagaPersistence();

    const state = { status: "awaiting_payment", orderId: "order-1" };
    await persistence.save("OrderFulfillment", "order-1", state, 0);

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual({ state, version: 1 });
  });
});
```

### load returns null for nonexistent saga instance

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should return null when no saga instance exists", async () => {
    const persistence = new InMemorySagaPersistence();

    const loaded = await persistence.load("OrderFulfillment", "nonexistent");

    expect(loaded).toBeNull();
  });
});
```

### save overwrites previous state when expectedVersion matches

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should overwrite state on subsequent saves with correct versions", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_payment" },
      0,
    );
    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_shipment" },
      1,
    );

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual({
      state: { status: "awaiting_shipment" },
      version: 2,
    });
  });
});
```

### throws ConcurrencyError when expectedVersion is stale

```ts
import { describe, it, expect } from "vitest";
import { ConcurrencyError } from "@noddde/core";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should throw ConcurrencyError when expectedVersion does not match", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_payment" },
      0,
    );

    await expect(
      persistence.save(
        "OrderFulfillment",
        "order-1",
        { status: "awaiting_shipment" },
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });
});
```

### namespace isolation between saga types

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should isolate state between different saga names", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "1",
      { status: "awaiting_payment" },
      0,
    );
    await persistence.save(
      "PaymentReconciliation",
      "1",
      { reconciled: false },
      0,
    );

    const orderState = await persistence.load("OrderFulfillment", "1");
    const paymentState = await persistence.load("PaymentReconciliation", "1");

    expect(orderState).toEqual({
      state: { status: "awaiting_payment" },
      version: 1,
    });
    expect(paymentState).toEqual({ state: { reconciled: false }, version: 1 });
  });
});
```

### multiple instances of the same saga type are independent

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should store separate state and version per saga instance ID", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_payment" },
      0,
    );
    await persistence.save(
      "OrderFulfillment",
      "order-2",
      { status: "shipped" },
      0,
    );

    const state1 = await persistence.load("OrderFulfillment", "order-1");
    const state2 = await persistence.load("OrderFulfillment", "order-2");

    expect(state1).toEqual({
      state: { status: "awaiting_payment" },
      version: 1,
    });
    expect(state2).toEqual({ state: { status: "shipped" }, version: 1 });
  });
});
```

### save then immediate load reflects the latest state and version

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("should reflect the latest state and version after rapid save/load cycles", async () => {
    const persistence = new InMemorySagaPersistence();

    for (let i = 0; i < 10; i++) {
      await persistence.save("Counter", "c-1", { count: i }, i);
    }

    const loaded = await persistence.load("Counter", "c-1");

    expect(loaded).toEqual({ state: { count: 9 }, version: 10 });
  });
});
```
