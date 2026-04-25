/* eslint-disable no-unused-vars */
import { describe, it, expect, expectTypeOf } from "vitest";
import type { ViewStore, ViewStoreFactory, ID } from "@noddde/core";
import { createViewStoreFactory } from "@noddde/core";

describe("ViewStore", () => {
  it("should accept a conforming object as ViewStore", () => {
    const store: ViewStore<{ id: string; balance: number }> = {
      save: async (_viewId: ID, _view: { id: string; balance: number }) => {},
      load: async (_viewId: ID) =>
        ({ id: "1", balance: 100 }) as
          | { id: string; balance: number }
          | undefined,
    };
    expectTypeOf(store.save).toBeFunction();
    expectTypeOf(store.load).toBeFunction();
  });
});

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

describe("ViewStore load return type", () => {
  it("should return TView | undefined | null from load", () => {
    type LoadReturn = Awaited<ReturnType<ViewStore<{ id: string }>["load"]>>;
    expectTypeOf<LoadReturn>().toEqualTypeOf<
      { id: string } | undefined | null
    >();
  });
});

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
      }),
    };
    expectTypeOf(factory).toMatchTypeOf<ViewStoreFactory<Item>>();
  });

  it("should declare ctx as unknown so adapters can narrow it", () => {
    type FakeTx = { id: string };
    class TxFactory implements ViewStoreFactory<Item> {
      getForContext(ctx?: unknown): ViewStore<Item> {
        const _tx = (ctx as FakeTx | undefined) ?? null;
        return {
          save: async () => {},
          load: async () => undefined,
        };
      }
    }
    const f: ViewStoreFactory<Item> = new TxFactory();
    expectTypeOf(f.getForContext).parameter(0).toEqualTypeOf<unknown>();
  });
});

describe("createViewStoreFactory", () => {
  interface Item {
    id: string;
  }

  it("should produce a factory whose getForContext delegates to the builder", () => {
    let lastCtx: unknown = "untouched";
    const seen: ViewStore<Item> = {
      save: async () => {},
      load: async () => undefined,
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
    }));
    expectTypeOf(factory.getForContext).toBeFunction();
    expectTypeOf<ReturnType<typeof factory.getForContext>>().toMatchTypeOf<
      ViewStore<Item>
    >();
  });
});
