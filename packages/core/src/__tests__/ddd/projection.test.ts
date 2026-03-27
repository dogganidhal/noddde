/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DefineEvents,
  DefineQueries,
  InferProjectionEvents,
  InferProjectionInfrastructure,
  InferProjectionQueries,
  InferProjectionView,
  Infrastructure,
  Query,
  ViewStore,
} from "@noddde/core";
import { defineProjection } from "@noddde/core";

describe("defineProjection", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  type AccountEvent = DefineEvents<{
    AccountCreated: { id: string; owner: string };
    DepositMade: { amount: number };
  }>;

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView };
    ListAccounts: { result: AccountView[] };
  }>;

  interface AccountInfra extends Infrastructure {
    accountRepo: { getById(id: string): Promise<AccountView> };
    accountListRepo: { getAll(): Promise<AccountView[]> };
  }

  type AccountProjectionDef = {
    events: AccountEvent;
    queries: AccountQuery;
    view: AccountView;
    infrastructure: AccountInfra;
  };

  const projection = defineProjection<AccountProjectionDef>({
    on: {
      AccountCreated: {
        reduce: (event, _view) => ({
          id: event.payload.id,
          balance: 0,
        }),
      },
      DepositMade: {
        reduce: (event, view) => ({
          ...view,
          balance: view.balance + event.payload.amount,
        }),
      },
    },
    queryHandlers: {
      GetAccountById: (payload, infra) => infra.accountRepo.getById(payload.id),
      ListAccounts: (_payload, infra) => infra.accountListRepo.getAll(),
    },
  });

  it("should have typed on map entries", () => {
    expectTypeOf(projection.on.AccountCreated!.reduce).toBeFunction();
    expectTypeOf(projection.on.DepositMade!.reduce).toBeFunction();
  });

  it("should have typed query handlers", () => {
    expectTypeOf(projection.queryHandlers.GetAccountById).not.toBeUndefined();
  });
});

describe("Reducer event parameter", () => {
  type MyEvent = DefineEvents<{ ItemAdded: { item: string } }>;

  type Def = {
    events: MyEvent;
    queries: Query<any>;
    view: string[];
    infrastructure: Infrastructure;
  };

  it("should pass the full event to reducer, not just payload", () => {
    const projection = defineProjection<Def>({
      on: {
        ItemAdded: {
          reduce: (event, view) => {
            expectTypeOf(event).toEqualTypeOf<{
              name: "ItemAdded";
              payload: { item: string };
            }>();
            expectTypeOf(event.name).toEqualTypeOf<"ItemAdded">();
            expectTypeOf(event.payload).toEqualTypeOf<{ item: string }>();
            return [...view, event.payload.item];
          },
        },
      },
      queryHandlers: {},
    });
    expectTypeOf(projection).toMatchTypeOf<object>();
  });
});

describe("Optional query handlers", () => {
  type Events = DefineEvents<{ Created: { id: string } }>;
  type Queries = DefineQueries<{
    GetById: { payload: { id: string }; result: { id: string } };
    ListAll: { result: { id: string }[] };
  }>;

  type Def = {
    events: Events;
    queries: Queries;
    view: { id: string };
    infrastructure: Infrastructure;
  };

  it("should compile with empty query handlers", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {},
    });
    expect(projection.queryHandlers).toEqual({});
  });

  it("should compile with partial query handlers", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {
        GetById: (payload, _infra) => ({ id: payload.id }),
      },
    });
    expect(projection.queryHandlers.GetById).toBeDefined();
  });
});

describe("Projection Infer utilities", () => {
  interface MyView {
    items: string[];
  }
  type MyEvent = DefineEvents<{ Added: { item: string } }>;
  type MyQuery = DefineQueries<{ GetItems: { result: string[] } }>;
  interface MyInfra extends Infrastructure {
    db: { query(): Promise<string[]> };
  }

  type Def = {
    events: MyEvent;
    queries: MyQuery;
    view: MyView;
    infrastructure: MyInfra;
  };

  const proj = defineProjection<Def>({
    on: {
      Added: {
        reduce: (event, view) => ({ items: [...view.items, event.payload.item] }),
      },
    },
    queryHandlers: {},
  });

  it("should infer view type", () => {
    expectTypeOf<InferProjectionView<typeof proj>>().toEqualTypeOf<MyView>();
  });

  it("should infer events type", () => {
    expectTypeOf<InferProjectionEvents<typeof proj>>().toEqualTypeOf<MyEvent>();
  });

  it("should infer queries type", () => {
    expectTypeOf<
      InferProjectionQueries<typeof proj>
    >().toEqualTypeOf<MyQuery>();
  });

  it("should infer infrastructure type", () => {
    expectTypeOf<
      InferProjectionInfrastructure<typeof proj>
    >().toEqualTypeOf<MyInfra>();
  });
});

describe("Async reducers", () => {
  type Events = DefineEvents<{ ItemAdded: { item: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: string[];
    infrastructure: Infrastructure;
  };

  it("should accept async reducer functions", () => {
    const proj = defineProjection<Def>({
      on: {
        ItemAdded: {
          reduce: async (event, view) => {
            return [...view, event.payload.item];
          },
        },
      },
      queryHandlers: {},
    });
    expect(proj).toBeDefined();
  });
});

describe("defineProjection identity", () => {
  type E = DefineEvents<{ X: { v: number } }>;
  type Def = {
    events: E;
    queries: Query<any>;
    view: number;
    infrastructure: Infrastructure;
  };

  it("should return the exact same config object", () => {
    const config = {
      on: { X: { reduce: (_event: any, _view: any) => 42 } },
      queryHandlers: {},
    };
    const result = defineProjection<Def>(config as any);
    expect(result).toBe(config);
  });
});

describe("Projection with id in on entries", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  type AccountEvent = DefineEvents<{
    AccountCreated: { id: string; owner: string };
    DepositMade: { accountId: string; amount: number };
  }>;

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView | null };
  }>;

  interface AccountViewStore extends ViewStore<AccountView> {
    findByBalanceRange(min: number, max: number): Promise<AccountView[]>;
  }

  type Def = {
    events: AccountEvent;
    queries: AccountQuery;
    view: AccountView;
    infrastructure: Infrastructure;
    viewStore: AccountViewStore;
  };

  it("should accept id functions in on entries", () => {
    const projection = defineProjection<Def>({
      on: {
        AccountCreated: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({
            id: event.payload.id,
            balance: 0,
          }),
        },
        DepositMade: {
          id: (event) => event.payload.accountId,
          reduce: (event, view) => ({
            ...view,
            balance: view.balance + event.payload.amount,
          }),
        },
      },
      queryHandlers: {
        GetAccountById: async (payload, { views }) =>
          (await views.load(payload.id)) ?? null,
      },
    });

    expect(projection.on.AccountCreated!.id).toBeTypeOf("function");
    expect(projection.on.DepositMade!.id).toBeTypeOf("function");
  });
});

describe("Query handlers with views injection", () => {
  interface ItemView {
    id: string;
    name: string;
  }

  interface ItemViewStore extends ViewStore<ItemView> {
    findByName(name: string): Promise<ItemView[]>;
  }

  type ItemEvent = DefineEvents<{ ItemCreated: { id: string; name: string } }>;
  type ItemQuery = DefineQueries<{
    GetItem: { payload: { id: string }; result: ItemView | null };
    FindByName: { payload: { name: string }; result: ItemView[] };
  }>;

  type Def = {
    events: ItemEvent;
    queries: ItemQuery;
    view: ItemView;
    infrastructure: Infrastructure;
    viewStore: ItemViewStore;
  };

  it("should inject typed views into query handler infrastructure", () => {
    const projection = defineProjection<Def>({
      on: {
        ItemCreated: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({
            id: event.payload.id,
            name: event.payload.name,
          }),
        },
      },
      queryHandlers: {
        GetItem: async (payload, infra) => {
          expectTypeOf(infra.views).toMatchTypeOf<ItemViewStore>();
          return (await infra.views.load(payload.id)) ?? null;
        },
        FindByName: (payload, infra) => {
          return infra.views.findByName(payload.name);
        },
      },
    });

    expectTypeOf(projection).toMatchTypeOf<object>();
  });
});

describe("Query handlers without viewStore (no views)", () => {
  interface MyInfra extends Infrastructure {
    repo: { getById(id: string): Promise<{ id: string }> };
  }

  type Events = DefineEvents<{ Created: { id: string } }>;
  type Queries = DefineQueries<{
    GetById: { payload: { id: string }; result: { id: string } };
  }>;

  type Def = {
    events: Events;
    queries: Queries;
    view: { id: string };
    infrastructure: MyInfra;
  };

  it("should use plain infrastructure without views", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {
        GetById: (payload, infra) => {
          expectTypeOf(infra).toEqualTypeOf<MyInfra>();
          return infra.repo.getById(payload.id);
        },
      },
    });

    expectTypeOf(projection).toMatchTypeOf<object>();
  });
});

describe("Projection with initialView", () => {
  type Events = DefineEvents<{ ItemAdded: { item: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: string[];
    infrastructure: Infrastructure;
  };

  it("should accept initialView field", () => {
    const projection = defineProjection<Def>({
      on: {
        ItemAdded: {
          reduce: (event, view) => [...view, event.payload.item],
        },
      },
      queryHandlers: {},
      initialView: [],
    });

    expect(projection.initialView).toEqual([]);
  });
});

describe("Projection consistency mode", () => {
  type Events = DefineEvents<{ Created: { id: string } }>;
  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string };
    infrastructure: Infrastructure;
    viewStore: ViewStore<{ id: string }>;
  };

  it("should accept eventual consistency", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {},
      consistency: "eventual",
    });
    expect(projection.consistency).toBe("eventual");
  });

  it("should accept strong consistency", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({ id: event.payload.id }),
        },
      },
      queryHandlers: {},
      consistency: "strong",
    });
    expect(projection.consistency).toBe("strong");
  });
});

describe("Partial on map", () => {
  type Events = DefineEvents<{
    Created: { id: string };
    Updated: { id: string; name: string };
    Deleted: { id: string };
    Archived: { id: string };
  }>;

  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string; name: string };
    infrastructure: Infrastructure;
  };

  it("should compile with only a subset of events in on map", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id, name: "" }),
        },
        Updated: {
          reduce: (event, view) => ({ ...view, name: event.payload.name }),
        },
        // Deleted and Archived intentionally omitted
      },
      queryHandlers: {},
    });

    expect(projection.on.Created).toBeDefined();
    expect(projection.on.Updated).toBeDefined();
    expect(projection.on.Deleted).toBeUndefined();
    expect(projection.on.Archived).toBeUndefined();
  });

  it("should compile with empty on map", () => {
    const projection = defineProjection<Def>({
      on: {},
      queryHandlers: {},
    });
    expect(Object.keys(projection.on)).toHaveLength(0);
  });
});

describe("Optional id in on entries", () => {
  type Events = DefineEvents<{
    Created: { id: string };
    Updated: { id: string; name: string };
  }>;

  type Def = {
    events: Events;
    queries: Query<any>;
    view: { id: string; name: string };
    infrastructure: Infrastructure;
  };

  it("should compile with id on some entries but not others", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          id: (event) => event.payload.id,
          reduce: (event, _view) => ({ id: event.payload.id, name: "" }),
        },
        Updated: {
          // no id — valid at type level
          reduce: (event, view) => ({ ...view, name: event.payload.name }),
        },
      },
      queryHandlers: {},
    });

    expect(projection.on.Created!.id).toBeTypeOf("function");
    expect(projection.on.Updated!.id).toBeUndefined();
  });

  it("should compile with no id on any entry", () => {
    const projection = defineProjection<Def>({
      on: {
        Created: {
          reduce: (event, _view) => ({ id: event.payload.id, name: "" }),
        },
      },
      queryHandlers: {},
    });

    expect(projection.on.Created!.id).toBeUndefined();
  });
});
