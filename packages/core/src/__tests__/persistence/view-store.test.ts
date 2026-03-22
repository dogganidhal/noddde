/* eslint-disable no-unused-vars */
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
