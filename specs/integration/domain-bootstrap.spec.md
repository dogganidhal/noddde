---
title: "Domain Bootstrap"
module: integration/domain-bootstrap
source_file:
  - packages/core/src/engine/domain.ts
  - packages/core/src/engine/implementations/ee-event-bus.ts
  - packages/core/src/engine/implementations/in-memory-command-bus.ts
  - packages/core/src/engine/implementations/in-memory-query-bus.ts
  - packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts
  - packages/core/src/engine/implementations/in-memory-saga-persistence.ts
status: implemented
exports: []
depends_on:
  - core/engine/domain
  - core/ddd/aggregate-root
  - core/ddd/projection
  - core/ddd/saga
docs:
  - domain-configuration/overview.mdx
  - getting-started/quick-start.mdx
---

# Domain Bootstrap

> Validates the `defineDomain()` + `wireDomain()` bootstrap sequence: `defineDomain` captures the pure domain structure, `wireDomain` connects it to infrastructure by invoking factories in the correct order (`infrastructure` -> `buses` -> `aggregates.persistence` -> `sagas.persistence`), wires EventBus subscriptions for projections and sagas, registers command/query handlers, and returns a fully initialized `Domain` whose `infrastructure` property exposes the merged custom + CQRS infrastructure.

## Involved Components

- **`defineDomain(definition)` + `wireDomain(definition, wiring)`** -- definition captures structure, wiring connects to infrastructure and returns the initialized instance.
- **`Domain`** -- holds configuration and resolved infrastructure. Exposes `infrastructure` getter and `dispatchCommand`.
- **`DomainDefinition`** -- the definition object with `writeModel`, `readModel`, `processModel?`.
- **`DomainWiring`** -- the wiring object with `infrastructure`, `buses`, `aggregates`, `sagas`, etc.
- All bus and persistence implementations used as infrastructure factory return values.

## Behavioral Requirements

1. **Factory invocation order**: `init()` must call factories in this sequence:
   - `wiring.infrastructure()` -- resolve custom infrastructure.
   - `wiring.buses(customInfra)` -- resolve CQRS buses, receiving custom infrastructure.
   - `wiring.aggregates.persistence()` -- resolve the persistence strategy.
   - `wiring.sagas.persistence()` -- resolve saga persistence (only if `processModel` is provided).
2. **Infrastructure merging**: The `domain.infrastructure` property must return the custom infrastructure merged with `CQRSInfrastructure` (commandBus, eventBus, queryBus).
3. **Projection wiring**: For each projection in `readModel.projections`, for each event name in its `on` map, a subscription is registered on the EventBus.
4. **Saga wiring**: For each saga in `processModel.sagas`, for each event name in its `on` map, a subscription is registered on the EventBus.
5. **Query handler registration**: For each projection with `queryHandlers`, and for each standalone query handler, the handler must be registered on the QueryBus.
6. **Standalone command handler registration**: For each entry in `writeModel.standaloneCommandHandlers`, the handler must be registered on the CommandBus.
7. **Async factories**: All factories may return Promises; `init()` must await them.

## Invariants

- `defineDomain` + `wireDomain` always returns a Promise that resolves to a `Domain` instance.
- `domain.infrastructure` is not accessible (throws or is undefined) before `init()` completes.
- If `processModel` is omitted, no saga wiring occurs and `sagas.persistence` factory is not called.
- If `wiring.infrastructure` is omitted, custom infrastructure defaults to `{}`.
- If `wiring.buses` is omitted, the framework must provide sensible defaults (or throw a clear error).
- If `wiring.aggregates` is omitted, the framework must provide a default in-memory implementation (or throw a clear error).
- Factory functions are called exactly once during `init()`.

## Edge Cases

- **All factories omitted**: `defineDomain` + `wireDomain` with only aggregates and projections, no explicit infrastructure factories. The framework should use defaults or throw clearly.
- **Async `wiring.infrastructure`**: The factory returns a Promise; `wiring.buses` must not be called until it resolves.
- **`processModel` omitted**: `sagas.persistence` factory is never called; no saga subscriptions are created.
- **Empty aggregates/projections**: `writeModel: { aggregates: {} }` and `readModel: { projections: {} }` should not cause errors.
- **Multiple aggregates and projections**: All are wired correctly without name collisions.
- **`wiring.buses` receives custom infrastructure**: The factory's parameter must be the resolved custom infrastructure, not undefined.

## Integration Points

- After bootstrap, `domain.dispatchCommand` is operational (tested in `command-dispatch-lifecycle`).
- After bootstrap, EventBus subscriptions for projections are active (tested in `event-projection-flow`).
- After bootstrap, EventBus subscriptions for sagas are active (tested in `saga-orchestration`).

## Test Scenarios

### Minimal configuration bootstraps successfully

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";

describe("Domain bootstrap - minimal config", () => {
  it("should initialize with empty aggregates and projections", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        aggregates: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    );

    expect(domain).toBeDefined();
    expect(domain.infrastructure).toBeDefined();
    expect(domain.infrastructure.commandBus).toBeInstanceOf(InMemoryCommandBus);
    expect(domain.infrastructure.eventBus).toBeInstanceOf(EventEmitterEventBus);
    expect(domain.infrastructure.queryBus).toBeInstanceOf(InMemoryQueryBus);
  });
});
```

### Custom infrastructure is merged with CQRS infrastructure

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

interface TestInfrastructure extends Infrastructure {
  clock: { now(): Date };
  apiKey: string;
}

describe("Domain bootstrap - custom infrastructure", () => {
  it("should merge custom infrastructure with CQRS buses", async () => {
    const fixedDate = new Date("2025-01-01");

    const domain = await wireDomain(
      defineDomain<TestInfrastructure>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          clock: { now: () => fixedDate },
          apiKey: "secret-123",
        }),
        aggregates: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        },
        buses: (infra) => {
          // Verify custom infrastructure is received
          expect(infra.apiKey).toBe("secret-123");
          return {
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          };
        },
      },
    );

    // Merged infrastructure should contain both custom and CQRS
    expect(domain.infrastructure.clock.now()).toEqual(fixedDate);
    expect(domain.infrastructure.apiKey).toBe("secret-123");
    expect(domain.infrastructure.commandBus).toBeDefined();
    expect(domain.infrastructure.eventBus).toBeDefined();
    expect(domain.infrastructure.queryBus).toBeDefined();
  });
});
```

### Async infrastructure factories are awaited in order

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";

describe("Domain bootstrap - async factories", () => {
  it("should await async infrastructure before calling buses", async () => {
    const callOrder: string[] = [];

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          callOrder.push("infrastructure");
          return {};
        },
        buses: async (infra) => {
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
      },
    );

    expect(callOrder[0]).toBe("infrastructure");
    expect(callOrder[1]).toBe("buses");
    expect(callOrder[2]).toBe("aggregatePersistence");
  });
});
```

### processModel omitted skips saga wiring

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";

describe("Domain bootstrap - no processModel", () => {
  it("should not call sagaPersistence factory when processModel is omitted", async () => {
    const sagaPersistenceFactory = vi.fn(() => new InMemorySagaPersistence());

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
        // processModel is intentionally omitted
      }),
      {
        aggregates: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        },
        sagas: { persistence: sagaPersistenceFactory },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    );

    expect(domain).toBeDefined();
    expect(sagaPersistenceFactory).not.toHaveBeenCalled();
  });
});
```

### Full configuration with aggregates, projections, and sagas

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineProjection,
  defineSaga,
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents, DefineQueries } from "@noddde/core";

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
  infrastructure: {};
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
  infrastructure: {};
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

describe("Domain bootstrap - full configuration", () => {
  it("should initialize with aggregates, projections, and sagas", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { Ticket } },
        readModel: { projections: { TicketListProjection } },
        processModel: { sagas: { TicketNotificationSaga } },
      }),
      {
        aggregates: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        },
        sagas: { persistence: () => new InMemorySagaPersistence() },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    );

    expect(domain).toBeDefined();
    expect(domain.infrastructure.commandBus).toBeDefined();
    expect(domain.infrastructure.eventBus).toBeDefined();
    expect(domain.infrastructure.queryBus).toBeDefined();
  });
});
```

### buses factory receives the resolved custom infrastructure

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

interface AppInfra extends Infrastructure {
  dbUrl: string;
}

describe("Domain bootstrap - buses parameter", () => {
  it("should pass resolved custom infrastructure to buses factory", async () => {
    let receivedInfra: any = null;

    await wireDomain(
      defineDomain<AppInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({ dbUrl: "postgres://localhost/test" }),
        buses: (infra) => {
          receivedInfra = infra;
          return {
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          };
        },
        aggregates: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        },
      },
    );

    expect(receivedInfra).not.toBeNull();
    expect(receivedInfra.dbUrl).toBe("postgres://localhost/test");
  });
});
```
