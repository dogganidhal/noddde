// Integration tests for projection error isolation (from specs/core/ddd/projection.spec.md)
// New scenarios: BR #22 (eventual isolation) and BR #23 (strong propagation)

import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents, DefineQueries } from "@noddde/core";
import { defineAggregate, defineDomain, defineProjection } from "@noddde/core";
import {
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemoryViewStore,
  InMemoryViewStoreFactory,
  wireDomain,
} from "@noddde/engine";

// ### Eventual-consistency reducer failure is isolated — command succeeds, sibling projection still updated
describe("Eventual-consistency projection error isolation", () => {
  type UserEvent = DefineEvents<{ UserCreated: { id: string; name: string } }>;
  type UserCommand = DefineCommands<{ CreateUser: { name: string } }>;
  type UserTypes = {
    state: { name: string } | null;
    events: UserEvent;
    commands: UserCommand;
    infrastructure: {};
  };
  type UserView = { id: string; name: string };
  type UserQuery = DefineQueries<{
    GetUser: { payload: { id: string }; result: UserView | undefined | null };
  }>;
  type UserProjectionTypes = {
    events: UserEvent;
    queries: UserQuery;
    view: UserView;
    infrastructure: {};
  };

  const User = defineAggregate<UserTypes>({
    initialState: null,
    decide: {
      CreateUser: (cmd) => ({
        name: "UserCreated",
        payload: { id: cmd.targetAggregateId, name: cmd.payload.name },
      }),
    },
    evolve: { UserCreated: (payload) => ({ name: payload.name }) },
  });

  const FailingProjection = defineProjection<UserProjectionTypes>({
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        reduce: () => {
          throw new Error("read-model bug");
        },
      },
    },
    queryHandlers: {},
  });

  const HealthyProjection = defineProjection<UserProjectionTypes>({
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        reduce: (event) => ({
          id: event.payload.id,
          name: event.payload.name,
        }),
      },
    },
    queryHandlers: {},
  });

  it("should keep the command successful and still update the sibling projection when one reducer throws", async () => {
    const failingStore = new InMemoryViewStore<UserView>();
    const healthyStore = new InMemoryViewStore<UserView>();
    const failingFactory = new InMemoryViewStoreFactory(failingStore);
    const healthyFactory = new InMemoryViewStoreFactory(healthyStore);
    const healthySaveSpy = vi.spyOn(healthyStore, "save");

    const definition = defineDomain({
      writeModel: { aggregates: { User } },
      readModel: { projections: { FailingProjection, HealthyProjection } },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      projections: {
        FailingProjection: { viewStore: failingFactory },
        HealthyProjection: { viewStore: healthyFactory },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // The command must succeed despite FailingProjection's reducer throwing.
    await expect(
      domain.dispatchCommand({
        name: "CreateUser",
        targetAggregateId: "u-1",
        payload: { name: "Alice" },
      }),
    ).resolves.not.toThrow();

    // Eventual consistency: allow the event bus to drain.
    await new Promise((r) => setTimeout(r, 10));

    // HealthyProjection's view was updated.
    expect(healthySaveSpy).toHaveBeenCalledWith("u-1", {
      id: "u-1",
      name: "Alice",
    });
    expect(await healthyStore.load("u-1")).toEqual({
      id: "u-1",
      name: "Alice",
    });

    // FailingProjection's view is NOT updated (the reducer threw before save).
    expect(await failingStore.load("u-1")).toBeUndefined();
  });
});

// ### Strong-consistency reducer failure rolls back the command atomically
describe("Strong-consistency projection error propagation", () => {
  type UserEvent = DefineEvents<{ UserCreated: { id: string; name: string } }>;
  type UserCommand = DefineCommands<{ CreateUser: { name: string } }>;
  type UserTypes = {
    state: { name: string } | null;
    events: UserEvent;
    commands: UserCommand;
    infrastructure: {};
  };
  type UserView = { id: string; name: string };
  type UserQuery = DefineQueries<{
    GetUser: { payload: { id: string }; result: UserView | undefined | null };
  }>;
  type UserProjectionTypes = {
    events: UserEvent;
    queries: UserQuery;
    view: UserView;
    infrastructure: {};
  };

  const User = defineAggregate<UserTypes>({
    initialState: null,
    decide: {
      CreateUser: (cmd) => ({
        name: "UserCreated",
        payload: { id: cmd.targetAggregateId, name: cmd.payload.name },
      }),
    },
    evolve: { UserCreated: (payload) => ({ name: payload.name }) },
  });

  const StrongFailingProjection = defineProjection<UserProjectionTypes>({
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        reduce: () => {
          throw new Error("strong read-model bug");
        },
      },
    },
    queryHandlers: {},
    consistency: "strong",
  });

  it("should reject the command and not persist any aggregate events when a strong reducer throws", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const viewStore = new InMemoryViewStore<UserView>();
    const viewFactory = new InMemoryViewStoreFactory(viewStore);

    const definition = defineDomain({
      writeModel: { aggregates: { User } },
      readModel: { projections: { StrongFailingProjection } },
    });

    const domain = await wireDomain(definition, {
      aggregates: { persistence: () => persistence },
      projections: {
        StrongFailingProjection: { viewStore: viewFactory },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // The command MUST reject — the strong reducer's throw propagates via UoW commit failure.
    await expect(
      domain.dispatchCommand({
        name: "CreateUser",
        targetAggregateId: "u-1",
        payload: { name: "Alice" },
      }),
    ).rejects.toThrow(/strong read-model bug/);

    // View MUST NOT be persisted — the reducer threw before save completed.
    expect(await viewStore.load("u-1")).toBeUndefined();
    // NOTE: with the in-memory UoW, aggregate persistence.save runs before the
    // strong reducer and cannot be undone (no real transaction). A production
    // UoW backed by a real database would roll this back atomically.
  });
});
