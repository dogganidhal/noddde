---
title: "ViewStore & ViewStoreFactory"
module: core/persistence/view-store
source_file: packages/core/src/persistence/view-store.ts
status: implemented
exports: [ViewStore, ViewStoreFactory, createViewStoreFactory]
depends_on: [core/id]
docs:
  - projections/overview.mdx
  - projections/view-persistence.mdx
---

# ViewStore & ViewStoreFactory

> Base persistence and query interface for projection views. Each projection can extend `ViewStore` with custom query methods (e.g., `findByBalanceRange`, `listByStatus`). The framework calls `save()`, `load()`, and `delete()` for automatic view persistence when a projection has an `identity` map. Reducers signal deletion by returning the `DeleteView` sentinel; the engine routes that to `delete()` instead of `save()`. This mirrors the `SagaPersistence` pattern but is scoped to a single view type per projection.
>
> The companion `ViewStoreFactory<TView>` is a singleton that mints `ViewStore<TView>` instances scoped to a transactional context. The engine calls `factory.getForContext(uow.context)` per strong-consistency read-modify-write so that the developer's view store — including any custom methods — uses the active transaction client. For non-transactional paths (eventual-consistency projections, query handlers), the engine calls `getForContext(undefined)` once and caches the result.

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

```ts
/**
 * Singleton factory that mints {@link ViewStore} instances scoped to a
 * transactional context. The framework calls `getForContext(uow.context)`
 * per strong-consistency read-modify-write to obtain a store bound to the
 * active transaction (e.g., a Prisma `TransactionClient`, a Drizzle `tx`,
 * a TypeORM `EntityManager`).
 *
 * Implementations typically hold shared resources (DB client, connection
 * pool) as member fields and return lightweight, per-call store instances.
 *
 * @typeParam TView - The view model type the minted stores persist.
 */
export interface ViewStoreFactory<TView = any> {
  /**
   * Returns a {@link ViewStore} scoped to the given transactional context.
   *
   * @param ctx - The {@link UnitOfWork.context} of the active unit of work,
   *   or `undefined` when called outside a transactional region (eventual-
   *   consistency projections, query handlers, in-memory paths).
   *   Implementations narrow this to their adapter's transaction type.
   * @returns A `ViewStore<TView>` whose `save`, `load`, and any custom
   *   methods participate in the given transaction (when `ctx` is
   *   defined) or use the base, non-transactional client (when `ctx`
   *   is `undefined`).
   */
  getForContext(ctx?: unknown): ViewStore<TView>;
}

/**
 * Convenience helper that wraps a builder function as a
 * {@link ViewStoreFactory}. Useful for simple cases where declaring a
 * dedicated factory class adds noise.
 */
export function createViewStoreFactory<TView>(
  build: (ctx?: unknown) => ViewStore<TView>,
): ViewStoreFactory<TView>;
```

- `ViewStoreFactory` is a singleton with a single method: `getForContext(ctx?)` returning a `ViewStore<TView>`.
- For transactional contexts (strong-consistency projections), `ctx` is the adapter-specific transaction handle from `UnitOfWork.context`.
- For non-transactional contexts (query handlers, eventual-consistency event handlers), `ctx` is `undefined`.
- Implementations are free to return a fresh instance per call (typical for tx-scoped stores) or a cached singleton (typical for in-memory).
- `createViewStoreFactory` is an optional convenience: pass a builder, get a factory.

## Behavioral Requirements

1. **Generic over view type** -- `ViewStore<TView>` is parameterized so that `save` accepts `TView` and `load` returns `TView | undefined | null`.
2. **Default type parameter** -- `TView` defaults to `any` for use in non-generic contexts (e.g., the runtime engine).
3. **Extensible** -- Users can extend `ViewStore` with custom query methods for advanced filtering. The base interface only provides `save`, `load`, and `delete`.
4. **Consistent with framework naming** -- Uses the `*Store` naming convention consistent with `SnapshotStore`, `IdempotencyStore`, and `SagaPersistence`.
5. **ID type is `ID`** -- The `viewId` parameter uses the framework's `ID` type (`string | number | bigint`), not just `string`.
6. **`ViewStoreFactory.getForContext(undefined)` returns a non-transactional store** — When called with `undefined`, the factory returns a `ViewStore` backed by the factory's base client (e.g., the bare `PrismaClient`, the bare `EntityManager`). This is the path used for eventual-consistency projection updates and query handlers.
7. **`ViewStoreFactory.getForContext(ctx)` returns a transactional store** — When called with a defined `ctx`, the factory returns a `ViewStore` backed by `ctx` (e.g., a Prisma `TransactionClient`, a tx-scoped `EntityManager`). All methods on the returned store — base `save`/`load`/`delete` and any custom methods — must use `ctx`.
8. **Custom methods inherit transactional participation** — Because scoping is at construction (the factory builds a fresh store with the tx client), a developer's extended `ViewStore` interface methods (e.g., `findByName`, `findAvailable`) automatically run on the transaction without needing per-method `ctx` parameters.
9. **`createViewStoreFactory` is identity-shaped** — `createViewStoreFactory(build)` returns `{ getForContext: build }`. Calling `factory.getForContext(ctx)` is equivalent to calling `build(ctx)`.
10. **Delete is idempotent** -- `delete(viewId)` resolves successfully whether or not a view exists for `viewId`. Implementations must NOT throw when the view is absent.
11. **Delete is total** -- After `delete(viewId)` resolves, a subsequent `load(viewId)` MUST return `undefined` or `null` (the same not-found semantics as a viewId that was never stored).

## Invariants

- `ViewStore` is an interface, not a class. Implementations are provided by the engine (`InMemoryViewStore`) or ORM adapters.
- `save`, `load`, and `delete` are the only required methods. All other methods are added by user extensions.
- The return type of `load` allows both `undefined` and `null` for flexibility across storage backends (some return `null`, others `undefined`).
- `ViewStoreFactory` is an interface with a single method, `getForContext`. Implementations may be classes (preferred when holding shared resources) or plain objects (e.g., produced by `createViewStoreFactory`).
- The framework treats `getForContext(undefined)` and `getForContext(ctx)` as **independent** call paths. Implementations must not assume that the returned instance is the same across calls; the engine may invoke `getForContext(ctx)` multiple times within a single transaction and expects each return value to be valid for that `ctx`.
- `delete` always resolves to `void` — the interface deliberately does not return a "was-deleted" boolean, since callers should treat deletion as idempotent.

## Edge Cases

- **Extension with custom methods**: A user-defined `BankAccountViewStore extends ViewStore<BankAccountView>` adding `findByBalanceRange(min, max)` is valid.
- **Primitive view types**: `ViewStore<number>` or `ViewStore<string>` are valid.
- **Complex view types**: `ViewStore<{ items: string[]; total: number }>` is valid.
- **In-memory factories**: Factories backing in-memory stores typically return the same shared instance for both `getForContext()` and `getForContext(ctx)`, since there is no real transaction.
- **Factory builders that ignore `ctx`**: `createViewStoreFactory(() => sharedStore)` is valid and behaves like an in-memory factory: every call returns the same store.
- **Delete on missing view**: `delete(viewId)` for a viewId that has no stored view is a no-op — resolves successfully without error.
- **Delete then load**: `load(viewId)` after `delete(viewId)` returns `undefined` or `null`.
- **Delete then save**: `save(viewId, view)` after `delete(viewId)` succeeds and stores the new view as if it were freshly created.

## Integration Points

- Used by `Projection.viewStore` factory to declare the view store type for a projection.
- Used by `ProjectionQueryInfra` to inject `{ views: ViewStore }` into query handler infrastructure.
- Implemented by `InMemoryViewStore` (engine), `TypeORMViewStore`, `PrismaViewStore`, `DrizzleViewStore` (ORM adapters).
- The engine calls `save()`, `load()`, and `delete()` during automatic view persistence when identity is configured. `delete()` is invoked when a projection reducer returns the `DeleteView` sentinel from `@noddde/core`.
- `ViewStoreFactory` is the **only** value type accepted by `ProjectionWiring.viewStore` in `DomainWiring` and by the optional `viewStore?` field on a `Projection` definition. The legacy `(infra) => ViewStore` function form is not accepted. The engine calls `factory.getForContext(uow.context)` once per enlisted strong-consistency read-modify-write, and `factory.getForContext(undefined)` once at init for query-handler / eventual-consistency paths.
- `InMemoryViewStoreFactory<TView>` (engine) is the default factory backing in-memory tests and prototypes; it always returns the same `InMemoryViewStore<TView>` instance regardless of `ctx`.

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

### ViewStoreFactory has a single getForContext method

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ViewStore, ViewStoreFactory } from "@noddde/core";

describe("ViewStoreFactory", () => {
  interface Item {
    id: string;
    name: string;
  }

  it("should accept a class implementation", () => {
    class MyFactory implements ViewStoreFactory<Item> {
      getForContext(): ViewStore<Item> {
        return {
          save: async () => {},
          load: async () => undefined,
          delete: async () => {},
        };
      }
    }
    const f: ViewStoreFactory<Item> = new MyFactory();
    expectTypeOf(f.getForContext).toBeFunction();
    expectTypeOf<ReturnType<typeof f.getForContext>>().toMatchTypeOf<
      ViewStore<Item>
    >();
  });

  it("should accept a plain-object implementation", () => {
    const factory: ViewStoreFactory<Item> = {
      getForContext: () => ({
        save: async () => {},
        load: async () => undefined,
        delete: async () => {},
      }),
    };
    expectTypeOf(factory).toMatchTypeOf<ViewStoreFactory<Item>>();
  });

  it("should narrow ctx via the implementation", () => {
    type FakeTx = { id: string };
    class TxFactory implements ViewStoreFactory<Item> {
      getForContext(ctx?: unknown): ViewStore<Item> {
        const _tx = (ctx as FakeTx | undefined) ?? null;
        return {
          save: async () => {},
          load: async () => undefined,
          delete: async () => {},
        };
      }
    }
    const f: ViewStoreFactory<Item> = new TxFactory();
    expectTypeOf(f.getForContext).parameter(0).toEqualTypeOf<unknown>();
  });
});
```

### createViewStoreFactory wraps a builder function

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import type { ViewStore } from "@noddde/core";
import { createViewStoreFactory } from "@noddde/core";

describe("createViewStoreFactory", () => {
  interface Item {
    id: string;
  }

  it("should produce a factory whose getForContext delegates to the builder", () => {
    let lastCtx: unknown = "untouched";
    const seen: ViewStore<Item> = {
      save: async () => {},
      load: async () => undefined,
      delete: async () => {},
    };
    const factory = createViewStoreFactory<Item>((ctx) => {
      lastCtx = ctx;
      return seen;
    });

    expect(factory.getForContext()).toBe(seen);
    expect(lastCtx).toBeUndefined();

    const tx = { kind: "fake-tx" };
    expect(factory.getForContext(tx)).toBe(seen);
    expect(lastCtx).toBe(tx);
  });

  it("should return a typed ViewStoreFactory<TView>", () => {
    const factory = createViewStoreFactory<Item>(() => ({
      save: async () => {},
      load: async () => undefined,
      delete: async () => {},
    }));
    expectTypeOf(factory.getForContext).toBeFunction();
    expectTypeOf<ReturnType<typeof factory.getForContext>>().toMatchTypeOf<
      ViewStore<Item>
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
