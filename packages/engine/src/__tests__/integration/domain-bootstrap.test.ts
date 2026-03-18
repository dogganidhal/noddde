/* eslint-disable no-unused-vars */
import { describe, it, expect, vi } from "vitest";
import type {
  DefineCommands,
  DefineEvents,
  DefineQueries,
  Infrastructure,
} from "@noddde/core";
import {
  defineAggregate,
  defineProjection,
  defineSaga,
} from "@noddde/core";
import {
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/engine";

// ---- Scenario 1: Minimal configuration bootstraps successfully ----

describe("Domain bootstrap - minimal config", () => {
  it("should initialize with empty aggregates and projections", async () => {
    const domain = await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    expect(domain).toBeDefined();
    expect(domain.infrastructure).toBeDefined();
    expect(domain.infrastructure.commandBus).toBeInstanceOf(InMemoryCommandBus);
    expect(domain.infrastructure.eventBus).toBeInstanceOf(EventEmitterEventBus);
    expect(domain.infrastructure.queryBus).toBeInstanceOf(InMemoryQueryBus);
  });
});

// ---- Scenario 2: Custom infrastructure is merged with CQRS infrastructure ----

interface TestInfrastructure extends Infrastructure {
  clock: { now(): Date };
  apiKey: string;
}

describe("Domain bootstrap - custom infrastructure", () => {
  it("should merge custom infrastructure with CQRS buses", async () => {
    const fixedDate = new Date("2025-01-01");

    const domain = await configureDomain<TestInfrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        provideInfrastructure: () => ({
          clock: { now: () => fixedDate },
          apiKey: "secret-123",
        }),
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        cqrsInfrastructure: (infra) => {
          // Verify custom infrastructure is received
          expect(infra.apiKey).toBe("secret-123");
          return {
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          };
        },
      },
    });

    // Merged infrastructure should contain both custom and CQRS
    expect(domain.infrastructure.clock.now()).toEqual(fixedDate);
    expect(domain.infrastructure.apiKey).toBe("secret-123");
    expect(domain.infrastructure.commandBus).toBeDefined();
    expect(domain.infrastructure.eventBus).toBeDefined();
    expect(domain.infrastructure.queryBus).toBeDefined();
  });
});

// ---- Scenario 3: Async infrastructure factories are awaited in order ----

describe("Domain bootstrap - async factories", () => {
  it("should await async provideInfrastructure before calling cqrsInfrastructure", async () => {
    const callOrder: string[] = [];

    const domain = await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        provideInfrastructure: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          callOrder.push("provideInfrastructure");
          return {};
        },
        cqrsInfrastructure: async (infra) => {
          callOrder.push("cqrsInfrastructure");
          return {
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          };
        },
        aggregatePersistence: async () => {
          callOrder.push("aggregatePersistence");
          return new InMemoryEventSourcedAggregatePersistence();
        },
      },
    });

    expect(callOrder[0]).toBe("provideInfrastructure");
    expect(callOrder[1]).toBe("cqrsInfrastructure");
    expect(callOrder[2]).toBe("aggregatePersistence");
  });
});

// ---- Scenario 4: processModel omitted skips saga wiring ----

describe("Domain bootstrap - no processModel", () => {
  it("should not call sagaPersistence factory when processModel is omitted", async () => {
    const sagaPersistenceFactory = vi.fn(() => new InMemorySagaPersistence());

    const domain = await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      // processModel is intentionally omitted
      infrastructure: {
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        sagaPersistence: sagaPersistenceFactory,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    expect(domain).toBeDefined();
    expect(sagaPersistenceFactory).not.toHaveBeenCalled();
  });
});

// ---- Scenario 5: Full configuration with aggregates, projections, and sagas ----

describe("Domain bootstrap - full configuration", () => {
  type TicketEvent = DefineEvents<{
    TicketCreated: { id: string; title: string };
    TicketResolved: { id: string };
  }>;

  type TicketCommand = DefineCommands<{
    CreateTicket: { title: string };
    ResolveTicket: void;
  }>;

  const Ticket = defineAggregate<{
    state: { resolved: boolean };
    events: TicketEvent;
    commands: TicketCommand;
    infrastructure: {};
  }>({
    initialState: { resolved: false },
    commands: {
      CreateTicket: (cmd) => ({
        name: "TicketCreated",
        payload: { id: cmd.targetAggregateId, title: cmd.payload.title },
      }),
      ResolveTicket: (cmd) => ({
        name: "TicketResolved",
        payload: { id: cmd.targetAggregateId },
      }),
    },
    apply: {
      TicketCreated: (payload, state) => ({ resolved: false }),
      TicketResolved: (payload, state) => ({ resolved: true }),
    },
  });

  const TicketListProjection = defineProjection<{
    events: TicketEvent;
    queries: DefineQueries<{ GetOpenTicketCount: { result: number } }>;
    view: { openCount: number };
    infrastructure: {};
  }>({
    reducers: {
      TicketCreated: (event, view) => ({
        openCount: (view?.openCount ?? 0) + 1,
      }),
      TicketResolved: (event, view) => ({
        openCount: (view?.openCount ?? 0) - 1,
      }),
    },
    queryHandlers: {},
  });

  type NotifyCommand = DefineCommands<{
    SendNotification: { ticketId: string; message: string };
  }>;

  const TicketNotificationSaga = defineSaga<{
    state: { notified: boolean };
    events: TicketEvent;
    commands: NotifyCommand;
    infrastructure: {};
  }>({
    initialState: { notified: false },
    startedBy: ["TicketCreated"],
    associations: {
      TicketCreated: (event) => event.payload.id,
      TicketResolved: (event) => event.payload.id,
    },
    handlers: {
      TicketCreated: (event, state) => ({
        state: { notified: true },
        commands: {
          name: "SendNotification",
          targetAggregateId: event.payload.id,
          payload: {
            ticketId: event.payload.id,
            message: `New ticket: ${event.payload.title}`,
          },
        },
      }),
      TicketResolved: (event, state) => ({
        state,
      }),
    },
  });

  it("should initialize with aggregates, projections, and sagas", async () => {
    const domain = await configureDomain({
      writeModel: { aggregates: { Ticket } },
      readModel: { projections: { TicketListProjection } },
      processModel: { sagas: { TicketNotificationSaga } },
      infrastructure: {
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        sagaPersistence: () => new InMemorySagaPersistence(),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    expect(domain).toBeDefined();
    expect(domain.infrastructure.commandBus).toBeDefined();
    expect(domain.infrastructure.eventBus).toBeDefined();
    expect(domain.infrastructure.queryBus).toBeDefined();
  });
});

// ---- Scenario 6: cqrsInfrastructure receives the resolved custom infrastructure ----

interface AppInfra extends Infrastructure {
  dbUrl: string;
}

describe("Domain bootstrap - cqrsInfrastructure parameter", () => {
  it("should pass resolved custom infrastructure to cqrsInfrastructure factory", async () => {
    let receivedInfra: any = null;

    await configureDomain<AppInfra>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        provideInfrastructure: () => ({ dbUrl: "postgres://localhost/test" }),
        cqrsInfrastructure: (infra) => {
          receivedInfra = infra;
          return {
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          };
        },
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
      },
    });

    expect(receivedInfra).not.toBeNull();
    expect(receivedInfra.dbUrl).toBe("postgres://localhost/test");
  });
});
