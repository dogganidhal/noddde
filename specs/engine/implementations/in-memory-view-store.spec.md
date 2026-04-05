---
title: "InMemoryViewStore"
module: engine/implementations/in-memory-view-store
source_file: packages/engine/src/implementations/in-memory-view-store.ts
status: implemented
exports: [InMemoryViewStore]
depends_on: [core/persistence/view-store]
docs:
  - ports/in-memory-implementations.mdx
---

# InMemoryViewStore

> In-memory `ViewStore` implementation that stores projection views in a `Map`, keyed by `String(viewId)`. Data is lost when the process exits. Includes convenience methods `findAll()` and `find(predicate)` for development and testing. Suitable for development, testing, and prototyping. For production, use a durable store (TypeORM, Prisma, Drizzle adapters, or custom).

## Type Contract

```ts
import type { ViewStore, ID } from "@noddde/core";

export class InMemoryViewStore<TView> implements ViewStore<TView> {
  save(viewId: ID, view: TView): Promise<void>;
  load(viewId: ID): Promise<TView | undefined>;

  /** Returns all stored views. Convenience for testing. */
  findAll(): Promise<TView[]>;

  /** Returns views matching a predicate. Convenience for testing. */
  find(predicate: (view: TView) => boolean): Promise<TView[]>;
}
```

- Implements the `ViewStore<TView>` interface from `@noddde/core`.
- `load` returns `undefined` (not `null`) when no view exists for the given key.
- `save` overwrites the entire view for the given viewId.
- `findAll` and `find` are convenience methods not on the base `ViewStore` interface.

## Behavioral Requirements

1. **Save stores view by ID** -- `save(viewId, view)` persists the view object keyed by `String(viewId)`, replacing any previously stored view for that ID.
2. **Load returns stored view** -- `load(viewId)` returns the most recently saved view for `String(viewId)`.
3. **Load returns undefined for nonexistent view** -- If no view has been saved for the given `viewId`, `load` returns `undefined`.
4. **String coercion of viewId** -- All `ID` types (`string`, `number`, `bigint`) are coerced to `string` via `String(viewId)` for map key consistency.
5. **Overwrite semantics** -- Each `save` replaces the previous view entirely. There is no merge or diff.
6. **findAll returns all views** -- `findAll()` returns an array of all stored view values (order not guaranteed).
7. **find filters by predicate** -- `find(predicate)` returns all stored views for which `predicate(view)` returns `true`.

## Invariants

- Purely in-memory. No filesystem, database, or network I/O.
- Supports arbitrary viewId types via `String()` coercion.
- No validation on the stored view. The caller is responsible for providing well-formed views.
- Single-process only. Not safe for sharing across worker threads.
- Generic: `InMemoryViewStore<TView>` preserves the view type.

## Edge Cases

- **Save then load returns exact view** -- The stored and loaded view should be referentially or structurally equal.
- **Multiple views** -- Views keyed by different IDs are independent entries.
- **Save with undefined view** -- Stores `undefined` as the view value. `load` will return `undefined`, indistinguishable from "not found".
- **Rapid save/load cycles** -- Each save immediately updates the store. A subsequent load always reflects the latest save.
- **Load before any save** -- Returns `undefined`.
- **findAll on empty store** -- Returns an empty array.
- **find with no matches** -- Returns an empty array.
- **Numeric and bigint IDs** -- `save(42, view)` and `save("42", view)` target the same key after `String()` coercion.

## Integration Points

- **Domain.init()** -- View stores are resolved during domain initialization from projection `viewStore` factories.
- **Projection event handling** -- When an event arrives for a projection with `identity`: (1) derive viewId via `identity[eventName](event)`, (2) `load(viewId)`, (3) if `undefined`, use `initialView`, (4) run reducer, (5) `save(viewId, newView)`.
- **Query handler ports** -- The resolved view store is injected as `{ views }` into query handler ports.

## Test Scenarios

### save and load round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should store and retrieve a view", async () => {
    const store = new InMemoryViewStore<{ id: string; balance: number }>();

    await store.save("acc-1", { id: "acc-1", balance: 100 });

    const loaded = await store.load("acc-1");

    expect(loaded).toEqual({ id: "acc-1", balance: 100 });
  });
});
```

### load returns undefined for nonexistent view

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should return undefined when no view exists", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    const loaded = await store.load("nonexistent");

    expect(loaded).toBeUndefined();
  });
});
```

### save overwrites previous view

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should overwrite view on subsequent saves", async () => {
    const store = new InMemoryViewStore<{ balance: number }>();

    await store.save("acc-1", { balance: 100 });
    await store.save("acc-1", { balance: 250 });

    const loaded = await store.load("acc-1");

    expect(loaded).toEqual({ balance: 250 });
  });
});
```

### multiple views are independent

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should store separate views per ID", async () => {
    const store = new InMemoryViewStore<{ balance: number }>();

    await store.save("acc-1", { balance: 100 });
    await store.save("acc-2", { balance: 200 });

    const view1 = await store.load("acc-1");
    const view2 = await store.load("acc-2");

    expect(view1).toEqual({ balance: 100 });
    expect(view2).toEqual({ balance: 200 });
  });
});
```

### findAll returns all stored views

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should return all views from findAll", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    await store.save("1", { id: "1" });
    await store.save("2", { id: "2" });
    await store.save("3", { id: "3" });

    const all = await store.findAll();

    expect(all).toHaveLength(3);
    expect(all).toEqual(
      expect.arrayContaining([{ id: "1" }, { id: "2" }, { id: "3" }]),
    );
  });
});
```

### findAll returns empty array when store is empty

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should return empty array when no views exist", async () => {
    const store = new InMemoryViewStore<{ id: string }>();

    const all = await store.findAll();

    expect(all).toEqual([]);
  });
});
```

### find filters views by predicate

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should filter views using predicate", async () => {
    const store = new InMemoryViewStore<{ id: string; balance: number }>();

    await store.save("1", { id: "1", balance: 50 });
    await store.save("2", { id: "2", balance: 150 });
    await store.save("3", { id: "3", balance: 250 });

    const highBalance = await store.find((v) => v.balance >= 100);

    expect(highBalance).toHaveLength(2);
    expect(highBalance).toEqual(
      expect.arrayContaining([
        { id: "2", balance: 150 },
        { id: "3", balance: 250 },
      ]),
    );
  });
});
```

### numeric and string IDs are coerced to same key

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should coerce numeric viewId to string key", async () => {
    const store = new InMemoryViewStore<{ value: number }>();

    await store.save(42, { value: 1 });

    const loaded = await store.load("42");

    expect(loaded).toEqual({ value: 1 });
  });
});
```

### rapid save/load reflects latest state

```ts
import { describe, it, expect } from "vitest";
import { InMemoryViewStore } from "@noddde/engine";

describe("InMemoryViewStore", () => {
  it("should reflect the latest state after rapid save/load cycles", async () => {
    const store = new InMemoryViewStore<{ count: number }>();

    for (let i = 0; i < 10; i++) {
      await store.save("counter", { count: i });
    }

    const loaded = await store.load("counter");

    expect(loaded).toEqual({ count: 9 });
  });
});
```
