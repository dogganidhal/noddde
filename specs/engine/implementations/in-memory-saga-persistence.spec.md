---
title: "InMemorySagaPersistence"
module: engine/implementations/in-memory-saga-persistence
source_file: packages/engine/src/implementations/in-memory-saga-persistence.ts
status: implemented
exports: [InMemorySagaPersistence]
depends_on: [engine/domain]
docs:
  - infrastructure/in-memory-implementations.mdx
---

# InMemorySagaPersistence

> In-memory SagaPersistence implementation that stores saga instance state snapshots in a Map, keyed by `(sagaName, sagaId)`. Data is lost when the process exits. Suitable for development, testing, and prototyping. Sagas use state-stored persistence (not event-sourced) because they track workflow progress, not domain truth.

## Type Contract

```ts
class InMemorySagaPersistence implements SagaPersistence {
  load(sagaName: string, sagaId: string): Promise<any | undefined>;
  save(sagaName: string, sagaId: string, state: any): Promise<void>;
}
```

- Implements the `SagaPersistence` interface from `engine/domain`.
- `load` returns `undefined` (or `null`) when no saga instance exists for the given key. This is the sentinel value the runtime uses to determine whether a saga instance needs to be created (using `initialState`) or updated.
- `save` overwrites the entire state for the saga instance, similar to `StateStoredAggregatePersistence`.

## Behavioral Requirements

1. **Save stores state snapshot** -- `save(sagaName, sagaId, state)` persists the full state object for the `(sagaName, sagaId)` pair, replacing any previously stored state.
2. **Load returns stored state** -- `load(sagaName, sagaId)` returns the most recently saved state for the given pair.
3. **Load returns undefined for new saga** -- If no state has been saved for `(sagaName, sagaId)`, `load` returns `undefined` or `null`. The runtime interprets this as "no saga instance exists" and uses `Saga.initialState` to bootstrap a new instance.
4. **Namespace isolation** -- State for `("OrderFulfillment", "order-1")` and `("PaymentReconciliation", "order-1")` are stored independently. The saga name acts as a namespace, just like aggregate name in aggregate persistence.
5. **Overwrite semantics** -- Each `save` replaces the previous state entirely. There is no merge or diff.

## Invariants

- Purely in-memory. No filesystem, database, or network I/O.
- Supports arbitrary saga names and IDs (any string).
- No validation on the stored state. The runtime is responsible for providing well-formed state.
- Single-process only. Not safe for sharing across worker threads.

## Edge Cases

- **Save then load returns exact state** -- The stored and loaded state should be referentially or structurally equal.
- **Multiple saga instances of the same type** -- `("OrderFulfillment", "order-1")` and `("OrderFulfillment", "order-2")` are independent entries.
- **Save with `undefined` state** -- Stores `undefined`, making `load` return `undefined`. This is indistinguishable from "not found". Callers should avoid storing `undefined` as state.
- **Rapid save/load cycles** -- Each save immediately updates the store. A subsequent load always reflects the latest save.
- **Load before any save** -- Returns `undefined` or `null`.

## Integration Points

- **Domain.init()** -- The domain receives the saga persistence instance from `DomainWiring.sagas.persistence`.
- **Saga event handling lifecycle** -- When an event arrives for a saga: (1) derive the saga instance ID via `saga.on[event.name].id(event)`, (2) `load(sagaName, sagaId)`, (3) if `undefined` and event is in `saga.startedBy`, use `saga.initialState`, (4) invoke the handler via `saga.on[event.name].handle(event, state, infrastructure)`, (5) `save(sagaName, sagaId, reaction.state)`, (6) dispatch `reaction.commands`.

## Test Scenarios

### save and load round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/core";

describe("InMemorySagaPersistence", () => {
  it("should store and retrieve saga state", async () => {
    const persistence = new InMemorySagaPersistence();

    const state = { status: "awaiting_payment", orderId: "order-1" };
    await persistence.save("OrderFulfillment", "order-1", state);

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual(state);
  });
});
```

### load returns undefined for nonexistent saga instance

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/core";

describe("InMemorySagaPersistence", () => {
  it("should return undefined when no saga instance exists", async () => {
    const persistence = new InMemorySagaPersistence();

    const state = await persistence.load("OrderFulfillment", "nonexistent");

    expect(state).toBeUndefined();
  });
});
```

### save overwrites previous state

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/core";

describe("InMemorySagaPersistence", () => {
  it("should overwrite state on subsequent saves", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save("OrderFulfillment", "order-1", {
      status: "awaiting_payment",
    });
    await persistence.save("OrderFulfillment", "order-1", {
      status: "awaiting_shipment",
    });

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual({ status: "awaiting_shipment" });
  });
});
```

### namespace isolation between saga types

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/core";

describe("InMemorySagaPersistence", () => {
  it("should isolate state between different saga names", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save("OrderFulfillment", "1", {
      status: "awaiting_payment",
    });
    await persistence.save("PaymentReconciliation", "1", {
      reconciled: false,
    });

    const orderState = await persistence.load("OrderFulfillment", "1");
    const paymentState = await persistence.load("PaymentReconciliation", "1");

    expect(orderState).toEqual({ status: "awaiting_payment" });
    expect(paymentState).toEqual({ reconciled: false });
  });
});
```

### multiple instances of the same saga type are independent

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/core";

describe("InMemorySagaPersistence", () => {
  it("should store separate state per saga instance ID", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save("OrderFulfillment", "order-1", {
      status: "awaiting_payment",
    });
    await persistence.save("OrderFulfillment", "order-2", {
      status: "shipped",
    });

    const state1 = await persistence.load("OrderFulfillment", "order-1");
    const state2 = await persistence.load("OrderFulfillment", "order-2");

    expect(state1).toEqual({ status: "awaiting_payment" });
    expect(state2).toEqual({ status: "shipped" });
  });
});
```

### save then immediate load reflects the latest state

```ts
import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/core";

describe("InMemorySagaPersistence", () => {
  it("should reflect the latest state after rapid save/load cycles", async () => {
    const persistence = new InMemorySagaPersistence();

    for (let i = 0; i < 10; i++) {
      await persistence.save("Counter", "c-1", { count: i });
    }

    const loaded = await persistence.load("Counter", "c-1");

    expect(loaded).toEqual({ count: 9 });
  });
});
```
