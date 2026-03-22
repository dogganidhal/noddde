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

> Base persistence and query interface for projection views. Each projection can extend `ViewStore` with custom query methods (e.g., `findByBalanceRange`, `listByStatus`). The framework calls `save()` and `load()` for automatic view persistence when a projection has an `identity` map. This mirrors the `SagaPersistence` pattern but is scoped to a single view type per projection.

## Type Contract

```ts
import type { ID } from "../id";

/**
 * Base persistence and query interface for projection views.
 * Each projection can extend this with custom query methods
 * (findByX, listByY, aggregate queries).
 *
 * The framework calls save() and load() for auto-persistence
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
}
```

- `ViewStore` is a generic interface parameterized by the view type `TView` (defaults to `any`).
- `save` persists a view instance keyed by `viewId`, replacing any previously stored view.
- `load` retrieves a view instance by `viewId`. Returns `undefined` or `null` if no view exists.
- Both methods are async (return `Promise`).
- `viewId` is typed as `ID` (`string | number | bigint`) from `@noddde/core`.

## Behavioral Requirements

1. **Generic over view type** -- `ViewStore<TView>` is parameterized so that `save` accepts `TView` and `load` returns `TView | undefined | null`.
2. **Default type parameter** -- `TView` defaults to `any` for use in non-generic contexts (e.g., the runtime engine).
3. **Extensible** -- Users can extend `ViewStore` with custom query methods for advanced filtering. The base interface only provides `save` and `load`.
4. **Consistent with framework naming** -- Uses the `*Store` naming convention consistent with `SnapshotStore`, `IdempotencyStore`, and `SagaPersistence`.
5. **ID type is `ID`** -- The `viewId` parameter uses the framework's `ID` type (`string | number | bigint`), not just `string`.

## Invariants

- `ViewStore` is an interface, not a class. Implementations are provided by the engine (`InMemoryViewStore`) or ORM adapters.
- `save` and `load` are the only required methods. All other methods are added by user extensions.
- The return type of `load` allows both `undefined` and `null` for flexibility across storage backends (some return `null`, others `undefined`).

## Edge Cases

- **Extension with custom methods**: A user-defined `BankAccountViewStore extends ViewStore<BankAccountView>` adding `findByBalanceRange(min, max)` is valid.
- **Primitive view types**: `ViewStore<number>` or `ViewStore<string>` are valid.
- **Complex view types**: `ViewStore<{ items: string[]; total: number }>` is valid.

## Integration Points

- Used by `Projection.viewStore` factory to declare the view store type for a projection.
- Used by `ProjectionQueryInfra` to inject `{ views: ViewStore }` into query handler infrastructure.
- Implemented by `InMemoryViewStore` (engine), `TypeORMViewStore`, `PrismaViewStore`, `DrizzleViewStore` (ORM adapters).
- The engine calls `save()` and `load()` during automatic view persistence when identity is configured.

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
        ({ id: "1", balance: 100 }) as { id: string; balance: number } | undefined,
    };
    expectTypeOf(store.save).toBeFunction();
    expectTypeOf(store.load).toBeFunction();
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
    };
    expectTypeOf(store).toMatchTypeOf<ViewStore<any>>();
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
    findByBalanceRange(
      min: number,
      max: number,
    ): Promise<AccountView[]>;
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
    };

    // All ID types should be accepted
    expectTypeOf(store.save).parameter(0).toEqualTypeOf<ID>();
    expectTypeOf(store.load).parameter(0).toEqualTypeOf<ID>();
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
