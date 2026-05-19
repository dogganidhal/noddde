// Integration test for saga error isolation from sibling subscribers
// From specs/engine/executors/saga-executor.spec.md

import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents, DefineQueries } from "@noddde/core";
import { defineAggregate, defineProjection, defineSaga } from "@noddde/core";
import {
  defineDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  InMemoryViewStore,
  InMemoryViewStoreFactory,
  wireDomain,
} from "@noddde/engine";

// ### saga handler failure is isolated from sibling subscribers on the same event
describe("Saga-failure isolation from sibling subscribers", () => {
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
  type FailingSagaState = { started: boolean };
  type FailingSagaTypes = {
    state: FailingSagaState;
    events: UserEvent;
    commands: never;
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

  const FailingSaga = defineSaga<FailingSagaTypes>({
    initialState: { started: false },
    startedBy: ["UserCreated"],
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        handle: () => {
          throw new Error("saga bug");
        },
      },
    },
  });

  it("should let sibling projections update and keep the command successful when a saga handler throws", async () => {
    const viewStore = new InMemoryViewStore<UserView>();
    const viewFactory = new InMemoryViewStoreFactory(viewStore);
    const sagaPersistence = new InMemorySagaPersistence();
    const sagaSaveSpy = vi.spyOn(sagaPersistence, "save");

    const definition = defineDomain({
      writeModel: { aggregates: { User } },
      readModel: {
        projections: { HealthyProjection },
        sagas: { FailingSaga },
      },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      projections: {
        HealthyProjection: { viewStore: viewFactory },
      },
      sagas: { persistence: () => sagaPersistence },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await expect(
      domain.dispatchCommand({
        name: "CreateUser",
        targetAggregateId: "u-1",
        payload: { name: "Alice" },
      }),
    ).resolves.not.toThrow();

    // Eventual consistency: allow the event bus to drain.
    await new Promise((r) => setTimeout(r, 10));

    // Saga state NOT persisted — its UoW rolled back (SagaExecutor contract).
    expect(sagaSaveSpy).not.toHaveBeenCalled();

    // Sibling projection still updated — bus isolation absorbed the saga's rethrow.
    expect(await viewStore.load("u-1")).toEqual({
      id: "u-1",
      name: "Alice",
    });
  });
});
