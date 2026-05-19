import { describe, it, expect } from "vitest";
import {
  DeleteView,
  defineAggregate,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  InMemoryViewStoreFactory,
  ProjectionNotFoundError,
  StrongConsistencyRebuildError,
  EventReaderUnavailableError,
  ViewStoreNotTruncatableError,
} from "@noddde/engine";

// ─── Shared helpers ──────────────────────────────────────────────────────────

type ItemView = { id: string };
type ItemEvent = DefineEvents<{ ItemCreated: { id: string } }>;
type ItemCommand = DefineCommands<{ CreateItem: { id: string } }>;
type ItemQuery = DefineQueries<{
  GetItem: { payload: { id: string }; result: ItemView | null };
}>;

const Item = defineAggregate<{
  state: ItemView | null;
  commands: ItemCommand;
  events: ItemEvent;
  infrastructure: {};
}>({
  name: "Item",
  initialState: () => null,
  decide: {
    CreateItem: (cmd) => ({
      name: "ItemCreated",
      payload: { id: cmd.payload.id },
    }),
  },
  evolve: {
    ItemCreated: (p) => ({ id: p.id }),
  },
});

const ItemSummary = defineProjection<{
  events: ItemEvent;
  queries: ItemQuery;
  view: ItemView;
  infrastructure: {};
}>({
  on: {
    ItemCreated: {
      id: (e) => e.payload.id,
      reduce: (e) => ({ id: e.payload.id }),
    },
  },
  queryHandlers: {},
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("rebuildProjection: empty event log", () => {
  it("should rebuild with zero counters and not throw", async () => {
    const def = defineDomain({
      writeModel: { aggregates: { Item } },
      readModel: { projections: { ItemSummary } },
    });
    const domain = await wireDomain(def, {
      projections: {
        ItemSummary: { viewStore: new InMemoryViewStoreFactory<ItemView>() },
      },
    });

    const result = await domain.rebuildProjection("ItemSummary");

    expect(result.projectionName).toBe("ItemSummary");
    expect(result.eventsRead).toBe(0);
    expect(result.eventsApplied).toBe(0);
    expect(result.viewsDeleted).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    await domain.shutdown();
  });
});

describe("rebuildProjection: single aggregate replay", () => {
  it("should reproduce a view identical to the live-built one", async () => {
    type BalanceView = { id: string; balance: number };
    type AccountEvent = DefineEvents<{
      AccountCreated: { id: string };
      DepositMade: { id: string; amount: number };
    }>;
    type AccountCommand = DefineCommands<{
      CreateAccount: { id: string };
      Deposit: { id: string; amount: number };
    }>;
    type AccountQuery = DefineQueries<{
      GetBalance: { payload: { id: string }; result: BalanceView | null };
    }>;

    const Account = defineAggregate<{
      state: BalanceView | null;
      commands: AccountCommand;
      events: AccountEvent;
      infrastructure: {};
    }>({
      name: "Account",
      initialState: () => null,
      decide: {
        CreateAccount: (cmd) => ({
          name: "AccountCreated",
          payload: { id: cmd.payload.id },
        }),
        Deposit: (cmd) => ({
          name: "DepositMade",
          payload: { id: cmd.payload.id, amount: cmd.payload.amount },
        }),
      },
      evolve: {
        AccountCreated: (p) => ({ id: p.id, balance: 0 }),
        DepositMade: (p, s) =>
          s
            ? { ...s, balance: s.balance + p.amount }
            : { id: p.id, balance: p.amount },
      },
    });

    const Balance = defineProjection<{
      events: AccountEvent;
      queries: AccountQuery;
      view: BalanceView;
      infrastructure: {};
    }>({
      on: {
        AccountCreated: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, balance: 0 }),
        },
        DepositMade: {
          id: (e) => e.payload.id,
          reduce: (e, v) =>
            v
              ? { ...v, balance: v.balance + e.payload.amount }
              : { id: e.payload.id, balance: e.payload.amount },
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<BalanceView>();
    const def = defineDomain({
      writeModel: { aggregates: { Account } },
      readModel: { projections: { Balance } },
    });
    const domain = await wireDomain(def, {
      projections: { Balance: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "CreateAccount",
      targetAggregateId: "acc-1",
      payload: { id: "acc-1" },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { id: "acc-1", amount: 100 },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { id: "acc-1", amount: 50 },
    });

    const liveView = await factory.getForContext().load("acc-1");
    expect(liveView).toEqual({ id: "acc-1", balance: 150 });

    const result = await domain.rebuildProjection("Balance");

    expect(result.eventsRead).toBe(3);
    expect(result.eventsApplied).toBe(3);
    expect(result.viewsDeleted).toBe(0);

    const rebuiltView = await factory.getForContext().load("acc-1");
    expect(rebuiltView).toEqual({ id: "acc-1", balance: 150 });

    await domain.shutdown();
  });
});

describe("rebuildProjection: truncates stale views", () => {
  it("should remove stale views even when no replay event re-creates them", async () => {
    type InvView = { id: string; name: string };
    type InvEvent = DefineEvents<{
      ItemCreated: { id: string; name: string };
    }>;
    type InvCommand = DefineCommands<{
      CreateItem: { id: string; name: string };
    }>;
    type InvQuery = DefineQueries<{
      GetItem: { payload: { id: string }; result: InvView | null };
    }>;

    const InvItem = defineAggregate<{
      state: InvView | null;
      commands: InvCommand;
      events: InvEvent;
      infrastructure: {};
    }>({
      name: "InvItem",
      initialState: () => null,
      decide: {
        CreateItem: (cmd) => ({
          name: "ItemCreated",
          payload: { id: cmd.payload.id, name: cmd.payload.name },
        }),
      },
      evolve: {
        ItemCreated: (p) => ({ id: p.id, name: p.name }),
      },
    });

    const Inventory = defineProjection<{
      events: InvEvent;
      queries: InvQuery;
      view: InvView;
      infrastructure: {};
    }>({
      on: {
        ItemCreated: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, name: e.payload.name }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<InvView>();
    const def = defineDomain({
      writeModel: { aggregates: { InvItem } },
      readModel: { projections: { Inventory } },
    });
    const domain = await wireDomain(def, {
      projections: { Inventory: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "CreateItem",
      targetAggregateId: "i-1",
      payload: { id: "i-1", name: "Widget" },
    });

    // Manually inject a stale view.
    await factory
      .getForContext()
      .save("stale-id", { id: "stale-id", name: "Stale" });
    expect(await factory.getForContext().load("stale-id")).toBeTruthy();

    const result = await domain.rebuildProjection("Inventory");

    expect(result.eventsApplied).toBe(1);
    expect(await factory.getForContext().load("stale-id")).toBeFalsy();
    expect(await factory.getForContext().load("i-1")).toEqual({
      id: "i-1",
      name: "Widget",
    });

    await domain.shutdown();
  });
});

describe("rebuildProjection: DeleteView during replay", () => {
  it("should call viewStore.delete and increment viewsDeleted", async () => {
    type AggView = { id: string; active: boolean };
    type AggEvent = DefineEvents<{
      Created: { id: string };
      Removed: { id: string };
    }>;
    type AggCommand = DefineCommands<{
      Create: { id: string };
      Remove: { id: string };
    }>;
    type AggQuery = DefineQueries<{
      Get: { payload: { id: string }; result: AggView | null };
    }>;

    const Agg = defineAggregate<{
      state: AggView | null;
      commands: AggCommand;
      events: AggEvent;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
        Remove: (cmd) => ({ name: "Removed", payload: { id: cmd.payload.id } }),
      },
      evolve: {
        Created: (p) => ({ id: p.id, active: true }),
        Removed: () => null,
      },
    });

    const Proj = defineProjection<{
      events: AggEvent;
      queries: AggQuery;
      view: AggView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, active: true }),
        },
        Removed: {
          id: (e) => e.payload.id,
          reduce: () => DeleteView,
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<AggView>();
    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: { Proj: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "x",
      payload: { id: "x" },
    });
    await domain.dispatchCommand({
      name: "Remove",
      targetAggregateId: "x",
      payload: { id: "x" },
    });

    const result = await domain.rebuildProjection("Proj");
    expect(result.eventsApplied).toBe(2);
    expect(result.viewsDeleted).toBe(1);
    expect(await factory.getForContext().load("x")).toBeFalsy();

    await domain.shutdown();
  });
});

describe("rebuildProjection: unhandled events are skipped", () => {
  it("should increment eventsRead but not eventsApplied", async () => {
    type SkipView = { id: string; balance: number };
    type SkipEvent = DefineEvents<{
      Created: { id: string };
      Noise: { id: string };
    }>;
    type SkipCommand = DefineCommands<{
      Create: { id: string };
      MakeNoise: { id: string };
    }>;
    type SkipQuery = DefineQueries<{
      Get: { payload: { id: string }; result: SkipView | null };
    }>;

    const SkipAgg = defineAggregate<{
      state: SkipView | null;
      commands: SkipCommand;
      events: SkipEvent;
      infrastructure: {};
    }>({
      name: "SkipAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
        MakeNoise: (cmd) => ({
          name: "Noise",
          payload: { id: cmd.payload.id },
        }),
      },
      evolve: {
        Created: (p) => ({ id: p.id, balance: 0 }),
        Noise: (_, s) => s,
      },
    });

    const SkipProj = defineProjection<{
      events: SkipEvent;
      queries: SkipQuery;
      view: SkipView;
      infrastructure: {};
    }>({
      // Only handles Created — Noise is ignored.
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, balance: 0 }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<SkipView>();
    const def = defineDomain({
      writeModel: { aggregates: { SkipAgg } },
      readModel: { projections: { SkipProj } },
    });
    const domain = await wireDomain(def, {
      projections: { SkipProj: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "x",
      payload: { id: "x" },
    });
    await domain.dispatchCommand({
      name: "MakeNoise",
      targetAggregateId: "x",
      payload: { id: "x" },
    });
    await domain.dispatchCommand({
      name: "MakeNoise",
      targetAggregateId: "x",
      payload: { id: "x" },
    });

    const result = await domain.rebuildProjection("SkipProj");
    expect(result.eventsRead).toBe(3);
    expect(result.eventsApplied).toBe(1);

    await domain.shutdown();
  });
});

describe("rebuildProjection: strong-consistency rejection", () => {
  it("should throw StrongConsistencyRebuildError and not call truncate", async () => {
    type StrongView = { id: string };
    type StrongEvent = DefineEvents<{ Created: { id: string } }>;
    type StrongCommand = DefineCommands<{ Create: { id: string } }>;
    type StrongQuery = DefineQueries<{
      Get: { payload: { id: string }; result: StrongView | null };
    }>;

    const StrongAgg = defineAggregate<{
      state: StrongView | null;
      commands: StrongCommand;
      events: StrongEvent;
      infrastructure: {};
    }>({
      name: "StrongAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const StrongProj = defineProjection<{
      events: StrongEvent;
      queries: StrongQuery;
      view: StrongView;
      infrastructure: {};
    }>({
      consistency: "strong",
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<StrongView>();
    let truncateCalled = false;
    const wrappedFactory = {
      getForContext: () => {
        const inner = factory.getForContext();
        return {
          ...inner,
          truncate: async () => {
            truncateCalled = true;
            await (inner as any).truncate?.();
          },
        };
      },
    };

    const def = defineDomain({
      writeModel: { aggregates: { StrongAgg } },
      readModel: { projections: { StrongProj } },
    });
    const domain = await wireDomain(def, {
      projections: { StrongProj: { viewStore: wrappedFactory as any } },
    });

    await expect(
      // eslint-disable-next-line no-unused-vars
      (domain.rebuildProjection as (_n: string) => Promise<unknown>)(
        "StrongProj",
      ),
    ).rejects.toBeInstanceOf(StrongConsistencyRebuildError);
    expect(truncateCalled).toBe(false);

    await domain.shutdown();
  });
});

describe("rebuildProjection: missing EventReader", () => {
  it("should throw EventReaderUnavailableError when no reader is resolvable", async () => {
    type NoReaderView = { id: string };
    type NoReaderEvent = DefineEvents<{ Created: { id: string } }>;
    type NoReaderCommand = DefineCommands<{ Create: { id: string } }>;
    type NoReaderQuery = DefineQueries<{
      Get: { payload: { id: string }; result: NoReaderView | null };
    }>;

    const NoReaderAgg = defineAggregate<{
      state: NoReaderView | null;
      commands: NoReaderCommand;
      events: NoReaderEvent;
      infrastructure: {};
    }>({
      name: "NoReaderAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const NoReaderProj = defineProjection<{
      events: NoReaderEvent;
      queries: NoReaderQuery;
      view: NoReaderView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { NoReaderAgg } },
      readModel: { projections: { NoReaderProj } },
    });

    // Wire state-stored persistence (does NOT implement EventReader) and no adapter.eventReader.
    const { InMemoryStateStoredAggregatePersistence } = await import(
      "@noddde/engine"
    );
    const domain = await wireDomain(def, {
      aggregates: {
        persistence: () => new InMemoryStateStoredAggregatePersistence(),
      },
      projections: {
        NoReaderProj: {
          viewStore: new InMemoryViewStoreFactory<NoReaderView>(),
        },
      },
    });

    await expect(
      // eslint-disable-next-line no-unused-vars
      (domain.rebuildProjection as (_n: string) => Promise<unknown>)(
        "NoReaderProj",
      ),
    ).rejects.toBeInstanceOf(EventReaderUnavailableError);

    await domain.shutdown();
  });
});

describe("rebuildProjection: missing truncate()", () => {
  it("should throw ViewStoreNotTruncatableError when the store cannot truncate", async () => {
    type NoTruncView = { id: string };
    type NoTruncEvent = DefineEvents<{ Created: { id: string } }>;
    type NoTruncCommand = DefineCommands<{ Create: { id: string } }>;
    type NoTruncQuery = DefineQueries<{
      Get: { payload: { id: string }; result: NoTruncView | null };
    }>;

    const NoTruncAgg = defineAggregate<{
      state: NoTruncView | null;
      commands: NoTruncCommand;
      events: NoTruncEvent;
      infrastructure: {};
    }>({
      name: "NoTruncAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const NoTruncProj = defineProjection<{
      events: NoTruncEvent;
      queries: NoTruncQuery;
      view: NoTruncView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const noTruncateFactory = {
      getForContext: () => ({
        save: async () => {},
        load: async () => undefined,
        delete: async () => {},
        // No truncate.
      }),
    };

    const def = defineDomain({
      writeModel: { aggregates: { NoTruncAgg } },
      readModel: { projections: { NoTruncProj } },
    });
    const domain = await wireDomain(def, {
      projections: { NoTruncProj: { viewStore: noTruncateFactory as any } },
    });

    await expect(
      // eslint-disable-next-line no-unused-vars
      (domain.rebuildProjection as (_n: string) => Promise<unknown>)(
        "NoTruncProj",
      ),
    ).rejects.toBeInstanceOf(ViewStoreNotTruncatableError);

    await domain.shutdown();
  });
});

describe("rebuildProjection: unknown projection name", () => {
  it("should throw ProjectionNotFoundError when name is not registered", async () => {
    type UnknownEvent = DefineEvents<{ X: { id: string } }>;
    type UnknownCommand = DefineCommands<{ DoX: { id: string } }>;

    const UnknownAgg = defineAggregate<{
      state: null;
      commands: UnknownCommand;
      events: UnknownEvent;
      infrastructure: {};
    }>({
      name: "UnknownAgg",
      initialState: () => null,
      decide: {
        DoX: (cmd) => ({ name: "X", payload: { id: cmd.payload.id } }),
      },
      evolve: { X: () => null },
    });

    const def = defineDomain({
      writeModel: { aggregates: { UnknownAgg } },
      readModel: { projections: {} },
    });
    const domain = await wireDomain(def);

    await expect(
      // eslint-disable-next-line no-unused-vars
      (domain.rebuildProjection as (_n: string) => Promise<unknown>)(
        "NotARegisteredProjection",
      ),
    ).rejects.toBeInstanceOf(ProjectionNotFoundError);

    await domain.shutdown();
  });
});

describe("rebuildProjection: subscriptions detach during replay", () => {
  it("should not dispatch live events to the projection while rebuilding", async () => {
    type DetachView = { id: string };
    type DetachEvent = DefineEvents<{ Created: { id: string } }>;
    type DetachCommand = DefineCommands<{ Create: { id: string } }>;
    type DetachQuery = DefineQueries<{
      Get: { payload: { id: string }; result: DetachView | null };
    }>;

    const DetachAgg = defineAggregate<{
      state: DetachView | null;
      commands: DetachCommand;
      events: DetachEvent;
      infrastructure: {};
    }>({
      name: "DetachAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    let liveReduces = 0;
    const DetachProj = defineProjection<{
      events: DetachEvent;
      queries: DetachQuery;
      view: DetachView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => {
            liveReduces++;
            return { id: e.payload.id };
          },
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<DetachView>();
    const def = defineDomain({
      writeModel: { aggregates: { DetachAgg } },
      readModel: { projections: { DetachProj } },
    });
    const domain = await wireDomain(def, {
      projections: { DetachProj: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "a",
      payload: { id: "a" },
    });
    // Live flow: 1 reduce
    expect(liveReduces).toBe(1);

    // Kick off the rebuild and intercept the eventBus to dispatch during the replay.
    const eventBus = domain.infrastructure.eventBus;
    const rebuildPromise = domain.rebuildProjection("DetachProj");
    await eventBus.dispatch({
      name: "Created",
      payload: { id: "b" },
      metadata: { aggregateName: "DetachAgg", aggregateId: "b" } as any,
    } as any);
    await rebuildPromise;

    // While detached, the dispatched event MUST NOT have gone through the reducer.
    // liveReduces increases by 1 for the replay of the original Created event.
    expect(liveReduces).toBe(2);

    await domain.shutdown();
  });
});

describe("rebuildProjection: subscriptions re-attach after replay", () => {
  it("should resume processing live events after rebuild resolves", async () => {
    type ReattachView = { id: string };
    type ReattachEvent = DefineEvents<{ Created: { id: string } }>;
    type ReattachCommand = DefineCommands<{ Create: { id: string } }>;
    type ReattachQuery = DefineQueries<{
      Get: { payload: { id: string }; result: ReattachView | null };
    }>;

    const ReattachAgg = defineAggregate<{
      state: ReattachView | null;
      commands: ReattachCommand;
      events: ReattachEvent;
      infrastructure: {};
    }>({
      name: "ReattachAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const ReattachProj = defineProjection<{
      events: ReattachEvent;
      queries: ReattachQuery;
      view: ReattachView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<ReattachView>();
    const def = defineDomain({
      writeModel: { aggregates: { ReattachAgg } },
      readModel: { projections: { ReattachProj } },
    });
    const domain = await wireDomain(def, {
      projections: { ReattachProj: { viewStore: factory } },
    });

    await domain.rebuildProjection("ReattachProj");

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "post-rebuild",
      payload: { id: "post-rebuild" },
    });

    const view = await factory.getForContext().load("post-rebuild");
    expect(view).toEqual({ id: "post-rebuild" });

    await domain.shutdown();
  });
});

describe("rebuildProjection: onProgress callback", () => {
  it("should invoke onProgress every N applied events", async () => {
    type ProgressView = { id: string };
    type ProgressEvent = DefineEvents<{ Created: { id: string } }>;
    type ProgressCommand = DefineCommands<{ Create: { id: string } }>;
    type ProgressQuery = DefineQueries<{
      Get: { payload: { id: string }; result: ProgressView | null };
    }>;

    const ProgressAgg = defineAggregate<{
      state: ProgressView | null;
      commands: ProgressCommand;
      events: ProgressEvent;
      infrastructure: {};
    }>({
      name: "ProgressAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const ProgressProj = defineProjection<{
      events: ProgressEvent;
      queries: ProgressQuery;
      view: ProgressView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { ProgressAgg } },
      readModel: { projections: { ProgressProj } },
    });
    const domain = await wireDomain(def, {
      projections: {
        ProgressProj: {
          viewStore: new InMemoryViewStoreFactory<ProgressView>(),
        },
      },
    });

    for (let i = 0; i < 5; i++) {
      await domain.dispatchCommand({
        name: "Create",
        targetAggregateId: `id-${i}`,
        payload: { id: `id-${i}` },
      });
    }

    const ticks: number[] = [];
    const result = await domain.rebuildProjection("ProgressProj", {
      progressInterval: 2,
      onProgress: ({ eventsApplied }) => {
        ticks.push(eventsApplied);
      },
    });

    expect(result.eventsApplied).toBe(5);
    expect(ticks).toEqual([2, 4]); // tick at applied=2 and applied=4

    await domain.shutdown();
  });
});

describe("rebuildProjection: type-level name inference", () => {
  it("should reject unknown projection names at compile time", async () => {
    type KnownView = { id: string };
    type KnownEvent = DefineEvents<{ Created: { id: string } }>;
    type KnownCommand = DefineCommands<{ Create: { id: string } }>;
    type KnownQuery = DefineQueries<{
      Get: { payload: { id: string }; result: KnownView | null };
    }>;

    const KnownAgg = defineAggregate<{
      state: KnownView | null;
      commands: KnownCommand;
      events: KnownEvent;
      infrastructure: {};
    }>({
      name: "KnownAgg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const KnownProj = defineProjection<{
      events: KnownEvent;
      queries: KnownQuery;
      view: KnownView;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { KnownAgg } },
      readModel: { projections: { KnownProj } },
    });
    const domain = await wireDomain(def, {
      projections: {
        KnownProj: { viewStore: new InMemoryViewStoreFactory<KnownView>() },
      },
    });

    // Sanity: known name is fine.
    await domain.rebuildProjection("KnownProj");

    // @ts-expect-error -- "Unknown" is not in keyof typeof projections.
    await expect(domain.rebuildProjection("Unknown")).rejects.toBeInstanceOf(
      ProjectionNotFoundError,
    );

    await domain.shutdown();
  });
});
