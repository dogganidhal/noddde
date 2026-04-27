/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type {
  DefineCommands,
  DefineEvents,
  Event,
  ID,
  UnitOfWork,
  UnitOfWorkFactory,
  ViewStore,
  ViewStoreFactory,
} from "@noddde/core";
import { defineAggregate, defineProjection } from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
} from "@noddde/engine";

/**
 * A unit of work that publishes a synthetic transactional context during
 * `commit()`. Mirrors the shape of adapter UoWs: `context` is `undefined`
 * outside the transactional region and is set to a sentinel inside it.
 */
class FakeTxUnitOfWork implements UnitOfWork {
  private operations: Array<() => Promise<void>> = [];
  private pendingEvents: Event[] = [];
  private completed = false;
  private _context: unknown = undefined;

  // eslint-disable-next-line no-unused-vars
  constructor(public readonly sentinel: { kind: string }) {}

  get context(): unknown {
    return this._context;
  }

  enlist(operation: () => Promise<void>): void {
    if (this.completed) throw new Error("UnitOfWork already completed");
    this.operations.push(operation);
  }

  deferPublish(...events: Event[]): void {
    if (this.completed) throw new Error("UnitOfWork already completed");
    this.pendingEvents.push(...events);
  }

  async commit(): Promise<Event[]> {
    if (this.completed) throw new Error("UnitOfWork already completed");
    this.completed = true;

    this._context = this.sentinel;
    try {
      for (const op of this.operations) {
        await op();
      }
    } finally {
      this._context = undefined;
    }

    return [...this.pendingEvents];
  }

  async rollback(): Promise<void> {
    if (this.completed) throw new Error("UnitOfWork already completed");
    this.completed = true;
    this.operations = [];
    this.pendingEvents = [];
  }
}

interface AccountView {
  id: string;
  balance: number;
}

type AccountEvent = DefineEvents<{
  AccountOpened: { id: string };
  Deposited: { id: string; amount: number };
}>;

type AccountCommand = DefineCommands<{
  OpenAccount: void;
  Deposit: { amount: number };
}>;

const Account = defineAggregate<{
  state: { balance: number };
  events: AccountEvent;
  commands: AccountCommand;
  infrastructure: {};
}>({
  initialState: { balance: 0 },
  decide: {
    OpenAccount: (command, _state) => ({
      name: "AccountOpened",
      payload: { id: command.targetAggregateId },
    }),
    Deposit: (command, _state) => ({
      name: "Deposited",
      payload: {
        id: command.targetAggregateId,
        amount: command.payload.amount,
      },
    }),
  },
  evolve: {
    AccountOpened: (_payload, _state) => ({ balance: 0 }),
    Deposited: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

type AccountProjectionDef = {
  events: AccountEvent;
  queries: never & { name: string; payload?: unknown };
  view: AccountView;
  infrastructure: {};
  viewStore: ViewStore<AccountView>;
};

const AccountProjection = defineProjection<AccountProjectionDef>({
  consistency: "strong",
  initialView: { id: "", balance: 0 },
  on: {
    AccountOpened: {
      id: (event) => event.payload.id,
      reduce: (event, _view) => ({ id: event.payload.id, balance: 0 }),
    },
    Deposited: {
      id: (event) => event.payload.id,
      reduce: (event, view) => ({
        id: view?.id ?? event.payload.id,
        balance: (view?.balance ?? 0) + event.payload.amount,
      }),
    },
  },
  queryHandlers: {},
});

/**
 * Records every interaction with stores and factories so we can assert
 * on transactional propagation and ordering.
 */
type StoreCallLog = Array<
  | { kind: "factory.getForContext"; ctx: unknown }
  | { kind: "store.load"; ctx: unknown; viewId: ID }
  | { kind: "store.save"; ctx: unknown; viewId: ID; view: AccountView }
  | { kind: "store.delete"; ctx: unknown; viewId: ID }
>;

function makeRecordingFactory(
  log: StoreCallLog,
  data: Map<string, AccountView>,
): ViewStoreFactory<AccountView> {
  return {
    getForContext(ctx?: unknown): ViewStore<AccountView> {
      log.push({ kind: "factory.getForContext", ctx });
      return {
        async load(viewId: ID) {
          log.push({ kind: "store.load", ctx, viewId });
          return data.get(String(viewId));
        },
        async save(viewId: ID, view: AccountView) {
          log.push({ kind: "store.save", ctx, viewId, view });
          data.set(String(viewId), view);
        },
        async delete(viewId: ID) {
          log.push({ kind: "store.delete", ctx, viewId });
          data.delete(String(viewId));
        },
      };
    },
  };
}

function buildDefinition() {
  return defineDomain({
    writeModel: { aggregates: { Account } },
    readModel: { projections: { Account: AccountProjection } },
  });
}

describe("ViewStoreFactory + UnitOfWork.context propagation", () => {
  it("invokes getForContext(uow.context) per enlisted op and routes load/save through the scoped store", async () => {
    const sentinel = { kind: "fake-tx" };
    const log: StoreCallLog = [];
    const data = new Map<string, AccountView>();
    const factory = makeRecordingFactory(log, data);

    const uowFactory: UnitOfWorkFactory = () => new FakeTxUnitOfWork(sentinel);
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await wireDomain(buildDefinition(), {
      aggregates: { persistence: () => persistence },
      projections: { Account: { viewStore: factory } },
      unitOfWork: () => uowFactory,
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // First call at init: factory.getForContext(undefined) for the cached
    // base store (used by query handlers / eventual reads).
    const initCalls = log.filter((e) => e.kind === "factory.getForContext");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]!.ctx).toBeUndefined();

    log.length = 0;

    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "acc-1",
    });

    // OpenAccount → AccountOpened → factory.getForContext(sentinel),
    // then load(acc-1), then save(acc-1, {id: acc-1, balance: 0}).
    expect(log).toEqual([
      { kind: "factory.getForContext", ctx: sentinel },
      { kind: "store.load", ctx: sentinel, viewId: "acc-1" },
      {
        kind: "store.save",
        ctx: sentinel,
        viewId: "acc-1",
        view: { id: "acc-1", balance: 0 },
      },
    ]);
    expect(data.get("acc-1")).toEqual({ id: "acc-1", balance: 0 });

    log.length = 0;

    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { amount: 100 },
    });

    // Deposit → Deposited → load reads the view written by the previous
    // command (now {balance: 0}), reduce adds 100, save stores 100.
    expect(log).toEqual([
      { kind: "factory.getForContext", ctx: sentinel },
      { kind: "store.load", ctx: sentinel, viewId: "acc-1" },
      {
        kind: "store.save",
        ctx: sentinel,
        viewId: "acc-1",
        view: { id: "acc-1", balance: 100 },
      },
    ]);
    expect(data.get("acc-1")).toEqual({ id: "acc-1", balance: 100 });
  });

  it("reads the load through the same scoped store as save (load-inside-tx)", async () => {
    // This guards against the historic bug where `load` was awaited at
    // dispatch time (outside the UoW commit region) and `save` was the
    // only call enlisted. The fix: both calls happen inside the enlisted
    // thunk, on the same `factory.getForContext(uow.context)` instance.
    const sentinel = { kind: "fake-tx" };
    const log: StoreCallLog = [];
    const factory = makeRecordingFactory(log, new Map());

    const uowFactory: UnitOfWorkFactory = () => new FakeTxUnitOfWork(sentinel);
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await wireDomain(buildDefinition(), {
      aggregates: { persistence: () => persistence },
      projections: { Account: { viewStore: factory } },
      unitOfWork: () => uowFactory,
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });
    log.length = 0;

    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "acc-2",
    });

    // The load + save must both be associated with the sentinel ctx —
    // not the undefined ctx of the cached base instance.
    const txCalls = log.filter((e) => e.kind !== "factory.getForContext");
    for (const c of txCalls) {
      expect(c.ctx).toBe(sentinel);
    }
  });

  it("treats InMemoryUnitOfWork.context as undefined", async () => {
    // The default in-memory UoW has no transaction, so `context` stays
    // undefined throughout the strong-consistency thunk.
    const log: StoreCallLog = [];
    const data = new Map<string, AccountView>();
    const factory = makeRecordingFactory(log, data);

    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const domain = await wireDomain(buildDefinition(), {
      aggregates: { persistence: () => persistence },
      projections: { Account: { viewStore: factory } },
      // No `unitOfWork` override → defaults to InMemoryUnitOfWork.
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });
    log.length = 0;

    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "acc-4",
    });

    const factoryCalls = log.filter((e) => e.kind === "factory.getForContext");
    // One per event reduce path — ctx must be undefined for in-memory.
    for (const c of factoryCalls) {
      expect(c.ctx).toBeUndefined();
    }
    expect(data.get("acc-4")).toEqual({ id: "acc-4", balance: 0 });
  });
});
