/* eslint-disable no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import type {
  DefineCommands,
  DefineEvents,
  DefineQueries,
  Infrastructure,
  Query,
} from "@noddde/core";
import { DeleteView, defineAggregate, defineProjection } from "@noddde/core";
import {
  defineDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemoryViewStore,
  wireDomain,
} from "@noddde/engine";

// ---- Shared domain setup reused across scenarios ----

type UserEvent = DefineEvents<{
  UserCreated: { id: string; name: string };
  UserDeleted: { id: string };
}>;
type UserCommand = DefineCommands<{
  CreateUser: { name: string };
  DeleteUser: void;
}>;
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
    DeleteUser: (cmd) => ({
      name: "UserDeleted",
      payload: { id: cmd.targetAggregateId },
    }),
  },
  evolve: {
    UserCreated: (payload) => ({ name: payload.name }),
    UserDeleted: () => null,
  },
});

// ---- Scenario: Eventual-consistency DeleteView ----

describe("Eventual-consistency DeleteView", () => {
  const UserProjection = defineProjection<UserProjectionTypes>({
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        reduce: (event) => ({
          id: event.payload.id,
          name: event.payload.name,
        }),
      },
      UserDeleted: {
        id: (event) => event.payload.id,
        reduce: () => DeleteView,
      },
    },
    queryHandlers: {},
  });

  it("should call viewStore.delete when reducer returns DeleteView", async () => {
    const viewStore = new InMemoryViewStore<UserView>();
    const deleteSpy = vi.spyOn(viewStore, "delete");
    const saveSpy = vi.spyOn(viewStore, "save");

    const definition = defineDomain({
      writeModel: { aggregates: { User } },
      readModel: { projections: { UserProjection } },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      projections: {
        UserProjection: { viewStore: () => viewStore },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "CreateUser",
      targetAggregateId: "u-1",
      payload: { name: "Alice" },
    });
    await domain.dispatchCommand({
      name: "DeleteUser",
      targetAggregateId: "u-1",
    });

    // Eventual consistency: allow the event bus to drain.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(saveSpy).toHaveBeenCalledWith("u-1", { id: "u-1", name: "Alice" });
    expect(deleteSpy).toHaveBeenCalledWith("u-1");
    expect(await viewStore.load("u-1")).toBeUndefined();
  });
});

// ---- Scenario: DeleteView is idempotent on a non-existent view ----

describe("DeleteView idempotency", () => {
  interface View {
    id: string;
  }

  type Events = DefineEvents<{ Removed: { id: string } }>;

  it("should not throw when reducer returns DeleteView for missing view", async () => {
    const projection = defineProjection<{
      events: Events;
      queries: Query<any>;
      view: View;
      infrastructure: Infrastructure;
    }>({
      on: {
        Removed: {
          id: (e) => e.payload.id,
          reduce: () => DeleteView,
        },
      },
      queryHandlers: {},
    });

    const viewStore = new InMemoryViewStore<View>();
    const handler = projection.on.Removed!;
    const event = { name: "Removed" as const, payload: { id: "x" } };

    const result = await handler.reduce(event, undefined as unknown as View);
    expect(result).toBe(DeleteView);

    // Simulating the engine's branching twice — both calls succeed.
    await expect(viewStore.delete("x")).resolves.toBeUndefined();
    await expect(viewStore.delete("x")).resolves.toBeUndefined();
    expect(await viewStore.load("x")).toBeUndefined();
  });
});

// ---- Scenario: Strong-consistency projection enlists DeleteView in the UoW ----

describe("Strong-consistency DeleteView", () => {
  const UserProjection = defineProjection<UserProjectionTypes>({
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        reduce: (event) => ({
          id: event.payload.id,
          name: event.payload.name,
        }),
      },
      UserDeleted: {
        id: (event) => event.payload.id,
        reduce: () => DeleteView,
      },
    },
    queryHandlers: {},
    consistency: "strong",
  });

  it("should delete the view atomically with the originating command", async () => {
    const viewStore = new InMemoryViewStore<UserView>();
    const deleteSpy = vi.spyOn(viewStore, "delete");

    const definition = defineDomain({
      writeModel: { aggregates: { User } },
      readModel: { projections: { UserProjection } },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      projections: {
        UserProjection: { viewStore: () => viewStore },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "CreateUser",
      targetAggregateId: "u-1",
      payload: { name: "Alice" },
    });
    // Strong consistency: deletion happens synchronously with the command.
    await domain.dispatchCommand({
      name: "DeleteUser",
      targetAggregateId: "u-1",
    });

    expect(deleteSpy).toHaveBeenCalledWith("u-1");
    expect(await viewStore.load("u-1")).toBeUndefined();
  });
});
