/* eslint-disable no-unused-vars */
import { describe, it, expect, vi } from "vitest";
import type {
  DefineCommands,
  DefineEvents,
  DefineQueries,
  Ports,
} from "@noddde/core";
import { defineAggregate, defineProjection, defineSaga } from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/engine";

// ---- Scenario 1: Minimal configuration bootstraps successfully ----

describe("Domain bootstrap - minimal config", () => {
  it("should initialize with empty aggregates and projections", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain).toBeDefined();
    expect(domain.adapters).toBeDefined();
    expect(domain.adapters.commandBus).toBeInstanceOf(InMemoryCommandBus);
    expect(domain.adapters.eventBus).toBeInstanceOf(EventEmitterEventBus);
    expect(domain.adapters.queryBus).toBeInstanceOf(InMemoryQueryBus);
  });
});

// ---- Scenario 2: Custom ports are merged with CQRS ports ----

interface TestPorts extends Ports {
  clock: { now(): Date };
  apiKey: string;
}

describe("Domain bootstrap - custom ports", () => {
  it("should merge custom ports with CQRS buses", async () => {
    const fixedDate = new Date("2025-01-01");

    const definition = defineDomain<TestPorts>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      adapters: () => ({
        clock: { now: () => fixedDate },
        apiKey: "secret-123",
      }),
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      buses: (ports) => {
        // Verify custom ports are received
        expect(ports.apiKey).toBe("secret-123");
        return {
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        };
      },
    });

    // Merged adapters should contain both custom and CQRS
    expect(domain.adapters.clock.now()).toEqual(fixedDate);
    expect(domain.adapters.apiKey).toBe("secret-123");
    expect(domain.adapters.commandBus).toBeDefined();
    expect(domain.adapters.eventBus).toBeDefined();
    expect(domain.adapters.queryBus).toBeDefined();
  });
});

// ---- Scenario 3: Async adapter factories are awaited in order ----

describe("Domain bootstrap - async factories", () => {
  it("should await async adapters before calling buses", async () => {
    const callOrder: string[] = [];

    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      adapters: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push("adapters");
        return {};
      },
      buses: async (ports) => {
        callOrder.push("buses");
        return {
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        };
      },
      aggregates: {
        persistence: async () => {
          callOrder.push("aggregatePersistence");
          return new InMemoryEventSourcedAggregatePersistence();
        },
      },
    });

    expect(callOrder[0]).toBe("adapters");
    expect(callOrder[1]).toBe("buses");
    expect(callOrder[2]).toBe("aggregatePersistence");
  });
});

// ---- Scenario 4: processModel omitted skips saga wiring ----

describe("Domain bootstrap - no processModel", () => {
  it("should not call sagaPersistence factory when processModel is omitted", async () => {
    const sagaPersistenceFactory = vi.fn(() => new InMemorySagaPersistence());

    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      // processModel is intentionally omitted
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      sagas: { persistence: sagaPersistenceFactory },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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
    ports: {};
  }>({
    initialState: { resolved: false },
    decide: {
      CreateTicket: (cmd) => ({
        name: "TicketCreated",
        payload: { id: cmd.targetAggregateId, title: cmd.payload.title },
      }),
      ResolveTicket: (cmd) => ({
        name: "TicketResolved",
        payload: { id: cmd.targetAggregateId },
      }),
    },
    evolve: {
      TicketCreated: (payload, state) => ({ resolved: false }),
      TicketResolved: (payload, state) => ({ resolved: true }),
    },
  });

  const TicketListProjection = defineProjection<{
    events: TicketEvent;
    queries: DefineQueries<{ GetOpenTicketCount: { result: number } }>;
    view: { openCount: number };
    ports: {};
  }>({
    on: {
      TicketCreated: {
        reduce: (event, view) => ({
          openCount: (view?.openCount ?? 0) + 1,
        }),
      },
      TicketResolved: {
        reduce: (event, view) => ({
          openCount: (view?.openCount ?? 0) - 1,
        }),
      },
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
    ports: {};
  }>({
    initialState: { notified: false },
    startedBy: ["TicketCreated"],
    on: {
      TicketCreated: {
        id: (event) => event.payload.id,
        handle: (event, state) => ({
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
      },
      TicketResolved: {
        id: (event) => event.payload.id,
        handle: (event, state) => ({
          state,
        }),
      },
    },
  });

  it("should initialize with aggregates, projections, and sagas", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Ticket } },
      readModel: { projections: { TicketListProjection } },
      processModel: { sagas: { TicketNotificationSaga } },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      sagas: { persistence: () => new InMemorySagaPersistence() },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain).toBeDefined();
    expect(domain.adapters.commandBus).toBeDefined();
    expect(domain.adapters.eventBus).toBeDefined();
    expect(domain.adapters.queryBus).toBeDefined();
  });
});

// ---- Scenario 6: buses receives the resolved custom ports ----

interface AppInfra extends Ports {
  dbUrl: string;
}

describe("Domain bootstrap - buses parameter", () => {
  it("should pass resolved custom ports to buses factory", async () => {
    let receivedPorts: any = null;

    const definition = defineDomain<AppInfra>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    await wireDomain(definition, {
      adapters: () => ({ dbUrl: "postgres://localhost/test" }),
      buses: (ports) => {
        receivedPorts = ports;
        return {
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        };
      },
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
    });

    expect(receivedPorts).not.toBeNull();
    expect(receivedPorts.dbUrl).toBe("postgres://localhost/test");
  });
});
