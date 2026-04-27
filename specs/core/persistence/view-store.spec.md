---
title: "ViewStore"
module: core/persistence/view-store
source_file: packages/core/src/persistence/view-store.ts
status: implemented
exports: [ViewStore]
depends_on: [core/id]
docs:
  - projections/overview.mdx
  - projections/view-persistence.mdx
---

# ViewStore

> Base persistence and query interface for projection views. Each projection can extend `ViewStore` with custom query methods (e.g., `findByBalanceRange`, `listByStatus`). The framework calls `save()`, `load()`, and `delete()` for automatic view persistence when a projection has an `identity` map. Reducers signal deletion by returning the `DeleteView` sentinel; the engine routes that to `delete()` instead of `save()`. This mirrors the `SagaPersistence` pattern but is scoped to a single view type per projection.

## Type Contract

```ts
import type { ID } from "../id";

/**
 * Base persistence and query interface for projection views.
 * Each projection can extend this with custom query methods
 * (findByX, listByY, aggregate queries).
 *
 * The framework calls save(), load(), and delete() for auto-persistence
 * when the projection has an `identity` map.
 */
export interface ViewStore<TView = any> {
  /**
   * Persists a view instance, replacing any previously stored view
   * for the given viewId.
   */
  save(viewId: ID, view: TView): Promise<void>;

  /**
   * Loads a view instance by ID.
   * Returns undefined or null if no view exists.
   */
  load(viewId: ID): Promise<TView | undefined | null>;

  /**
   * Deletes a view instance by ID. Idempotent — deleting a non-existent
   * view is a no-op and resolves successfully without error.
   */
  delete(viewId: ID): Promise<void>;
}
```

- `ViewStore` is a generic interface parameterized by the view type `TView` (defaults to `any`).
- `save` persists a view instance keyed by `viewId`, replacing any previously stored view.
- `load` retrieves a view instance by `viewId`. Returns `undefined` or `null` if no view exists.
- `delete` removes a view instance by `viewId`. Idempotent — never throws on missing views.
- All three methods are async (return `Promise`).
- `viewId` is typed as `ID` (`string | number | bigint`) from `@noddde/core`.

## Behavioral Requirements

1. **Generic over view type** -- `ViewStore<TView>` is parameterized so that `save` accepts `TView` and `load` returns `TView | undefined | null`.
2. **Default type parameter** -- `TView` defaults to `any` for use in non-generic contexts (e.g., the runtime engine).
3. **Extensible** -- Users can extend `ViewStore` with custom query methods for advanced filtering. The base interface only provides `save`, `load`, and `delete`.
4. **Consistent with framework naming** -- Uses the `*Store` naming convention consistent with `SnapshotStore`, `IdempotencyStore`, and `SagaPersistence`.
5. **ID type is `ID`** -- The `viewId` parameter uses the framework's `ID` type (`string | number | bigint`), not just `string`.
6. **Delete is idempotent** -- `delete(viewId)` resolves successfully whether or not a view exists for `viewId`. Implementations must NOT throw when the view is absent.
7. **Delete is total** -- After `delete(viewId)` resolves, a subsequent `load(viewId)` MUST return `undefined` or `null` (the same not-found semantics as a viewId that was never stored).

## Invariants

- `ViewStore` is an interface, not a class. Implementations are provided by the engine (`InMemoryViewStore`) or ORM adapters.
- `save`, `load`, and `delete` are the only required methods. All other methods are added by user extensions.
- The return type of `load` allows both `undefined` and `null` for flexibility across storage backends (some return `null`, others `undefined`).
- `delete` always resolves to `void` — the interface deliberately does not return a "was-deleted" boolean, since callers should treat deletion as idempotent.

## Edge Cases

- **Extension with custom methods**: A user-defined `BankAccountViewStore extends ViewStore<BankAccountView>` adding `findByBalanceRange(min, max)` is valid.
- **Primitive view types**: `ViewStore<number>` or `ViewStore<string>` are valid.
- **Complex view types**: `ViewStore<{ items: string[]; total: number }>` is valid.
- **Delete on missing view**: `delete(viewId)` for a viewId that has no stored view is a no-op — resolves successfully without error.
- **Delete then load**: `load(viewId)` after `delete(viewId)` returns `undefined` or `null`.
- **Delete then save**: `save(viewId, view)` after `delete(viewId)` succeeds and stores the new view as if it were freshly created.

## Integration Points

- Used by `Projection.viewStore` factory to declare the view store type for a projection.
- Used by `ProjectionQueryInfra` to inject `{ views: ViewStore }` into query handler infrastructure.
- Implemented by `InMemoryViewStore` (engine), `TypeORMViewStore`, `PrismaViewStore`, `DrizzleViewStore` (ORM adapters).
- The engine calls `save()`, `load()`, and `delete()` during automatic view persistence when identity is configured. `delete()` is invoked when a projection reducer returns the `DeleteView` sentinel from `@noddde/core`.

## Test Scenarios

### ViewStore interface is assignable from a conforming object

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore, ID } from "@noddde/core";

describe("ViewStore", () => {
  it("should accept a conforming object as ViewStore", () => {
    const store: ViewStore<{ id: string; balance: number }> = {
      save: async (_viewId: ID, _view: { id: string; balance: number }) => {},
      load: async (_viewId: ID) =>
        ({ id: "1", balance: 100 }) as
          | { id: string; balance: number }
          | undefined,
      delete: async (_viewId: ID) => {},
    };
    expectTypeOf(store.save).toBeFunction();
    expectTypeOf(store.load).toBeFunction();
    expectTypeOf(store.delete).toBeFunction();
  });
});
```

### ViewStore default type parameter is any

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore, ID } from "@noddde/core";

describe("ViewStore default type", () => {
  it("should default TView to any", () => {
    type DefaultStore = ViewStore;
    const store: DefaultStore = {
      save: async (_viewId: ID, _view: any) => {},
      load: async (_viewId: ID) => undefined,
      delete: async (_viewId: ID) => {},
    };
    expectTypeOf(store).toMatchTypeOf<ViewStore<any>>();
  });
});
```

### ViewStore exposes a delete method

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore, ID } from "@noddde/core";

describe("ViewStore delete signature", () => {
  it("should accept ID and return Promise<void>", () => {
    type Delete = ViewStore<{ id: string }>["delete"];
    expectTypeOf<Delete>().parameter(0).toEqualTypeOf<ID>();
    expectTypeOf<ReturnType<Delete>>().toEqualTypeOf<Promise<void>>();
  });
});
```

### ViewStore can be extended with custom query methods

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore } from "@noddde/core";

describe("ViewStore extension", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  interface AccountViewStore extends ViewStore<AccountView> {
    findByBalanceRange(min: number, max: number): Promise<AccountView[]>;
  }

  it("should allow extending with custom query methods", () => {
    expectTypeOf<AccountViewStore>().toMatchTypeOf<ViewStore<AccountView>>();
    expectTypeOf<AccountViewStore["findByBalanceRange"]>().toBeFunction();
  });
});
```

### ViewStore accepts ID types for viewId

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore, ID } from "@noddde/core";

describe("ViewStore ID parameter", () => {
  it("should accept string, number, and bigint as viewId", () => {
    const store: ViewStore<string> = {
      save: async (_viewId: ID, _view: string) => {},
      load: async (_viewId: ID) => undefined,
      delete: async (_viewId: ID) => {},
    };

    // All ID types should be accepted
    expectTypeOf(store.save).parameter(0).toEqualTypeOf<ID>();
    expectTypeOf(store.load).parameter(0).toEqualTypeOf<ID>();
    expectTypeOf(store.delete).parameter(0).toEqualTypeOf<ID>();
  });
});
```

### ViewStore load returns TView or undefined or null

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore } from "@noddde/core";

describe("ViewStore load return type", () => {
  it("should return TView | undefined | null from load", () => {
    type LoadReturn = Awaited<ReturnType<ViewStore<{ id: string }>["load"]>>;
    expectTypeOf<LoadReturn>().toEqualTypeOf<
      { id: string } | undefined | null
    >();
  });
});
```

### ViewStore extension still satisfies the base interface with delete

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore } from "@noddde/core";

describe("ViewStore extension preserves delete", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  interface AccountViewStore extends ViewStore<AccountView> {
    findByBalanceRange(min: number, max: number): Promise<AccountView[]>;
  }

  it("should still require delete on extended stores", () => {
    expectTypeOf<AccountViewStore["delete"]>().toEqualTypeOf<
      ViewStore<AccountView>["delete"]
    >();
  });
});
```
