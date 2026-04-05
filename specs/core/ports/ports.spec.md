---
title: "Ports & CQRSPorts"
module: ports/index
source_file: packages/core/src/ports/index.ts
status: implemented
exports: [Ports, FrameworkPorts, CQRSPorts]
depends_on: [cqrs/command/command-bus, cqrs/query/query-bus, edd/event-bus]
docs:
  - ports/overview.mdx
  - ports/custom-ports.mdx
  - ports/cqrs-ports.mdx
---

# Ports & CQRSPorts

> `Ports` is the base type for all external dependencies in the framework. It is an empty object type (`{}`) that users extend to declare their domain's dependencies. `CQRSPorts` is a framework-provided interface containing the three CQRS buses, automatically merged into ports for standalone command handlers and saga event handlers.

## Type Contract

- **`Ports`** is a type alias for `{}` (empty object type).
  - It serves as the base constraint for all ports type parameters.
  - Users extend it by declaring interfaces that include their dependencies.
- **`FrameworkPorts`** is an interface with one field:
  - `logger: Logger` -- the framework logger instance, available to all handlers.
  - Merged into every handler's `ports` parameter by the engine via intersection (`&`).
  - Handlers can use `ports.logger` without declaring it in their custom ports type.
- **`CQRSPorts`** is an interface with three fields:
  - `commandBus: CommandBus` -- for dispatching commands.
  - `eventBus: EventBus` -- for publishing events.
  - `queryBus: QueryBus` -- for dispatching queries.

## Behavioral Requirements

- `Ports` being `{}` means any object type is assignable to it (it is the top of the ports type hierarchy).
- `FrameworkPorts` provides the framework logger. It is merged with user ports via intersection (`&`) in **all** handler types (event handlers, command handlers, query handlers, saga event handlers, standalone command handlers).
- `CQRSPorts` provides the runtime-injected CQRS buses. It is merged with user ports via intersection (`&`) in handlers that need bus access (standalone command handlers, saga event handlers).
- The separation ensures that pure handlers (like evolve handlers) have no ports access, all handlers get the framework logger via `FrameworkPorts`, and orchestration handlers (standalone commands, sagas) additionally get CQRS buses.

## Invariants

- `Ports` is exactly `{}` -- it has no required fields.
- Any interface extending `Ports` is a valid ports type.
- `FrameworkPorts` always has exactly one field: `logger`.
- `CQRSPorts` always has exactly three fields: `commandBus`, `eventBus`, `queryBus`.
- `FrameworkPorts` and `CQRSPorts` are NOT subtypes of `Ports` per se -- they are separate interfaces that get intersected where needed.

## Edge Cases

- **Empty ports**: Using `Ports` directly means the handler gets no custom dependencies.
- **Ports with overlapping bus names**: If a user declares `commandBus` in their custom ports, the intersection with `CQRSPorts` will merge the types (intersection of the field types).
- **`CQRSPorts` as standalone**: Can be used as a type on its own for contexts that only need bus access.

## Integration Points

- `Ports` is the base constraint for:
  - `EventHandler<TEvent, TPorts extends Ports>`
  - `QueryHandler<TPorts extends Ports, TQuery>`
  - `StandaloneCommandHandler<TPorts extends Ports, TCommand>`
  - `AggregateTypes["ports"]`
  - `ProjectionTypes["ports"]`
  - `SagaTypes["ports"]`
- `FrameworkPorts` is merged via `&` in **all** handler types:
  - `EventHandler` second parameter: `TPorts & FrameworkPorts`
  - `DecideHandler` (aggregate) third parameter: `TPorts & FrameworkPorts`
  - `QueryHandler` second parameter: `TPorts & FrameworkPorts`
  - `StandaloneCommandHandler` second parameter: `TPorts & CQRSPorts & FrameworkPorts`
  - `SagaEventHandler` third parameter: `TPorts & CQRSPorts & FrameworkPorts`
- `CQRSPorts` is additionally merged via `&` in:
  - `StandaloneCommandHandler` second parameter
  - `SagaEventHandler` third parameter

## Test Scenarios

### Ports is an empty object type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Ports } from "@noddde/core";

describe("Ports", () => {
  it("should be assignable from any object", () => {
    expectTypeOf<{ foo: string }>().toMatchTypeOf<Ports>();
  });

  it("should be assignable from empty object", () => {
    expectTypeOf<{}>().toEqualTypeOf<Ports>();
  });

  it("should allow extension via interface", () => {
    interface MyPorts extends Ports {
      clock: { now(): Date };
    }
    expectTypeOf<MyPorts>().toMatchTypeOf<Ports>();
    expectTypeOf<MyPorts["clock"]>().toEqualTypeOf<{ now(): Date }>();
  });
});
```

### CQRSPorts contains the three buses

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { CQRSPorts, CommandBus, EventBus, QueryBus } from "@noddde/core";

describe("CQRSPorts", () => {
  it("should have commandBus", () => {
    expectTypeOf<CQRSPorts["commandBus"]>().toEqualTypeOf<CommandBus>();
  });

  it("should have eventBus", () => {
    expectTypeOf<CQRSPorts["eventBus"]>().toEqualTypeOf<EventBus>();
  });

  it("should have queryBus", () => {
    expectTypeOf<CQRSPorts["queryBus"]>().toEqualTypeOf<QueryBus>();
  });
});
```

### Ports intersection with CQRSPorts

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Ports, CQRSPorts, CommandBus } from "@noddde/core";

describe("Ports & CQRSPorts intersection", () => {
  interface MyPorts extends Ports {
    db: { query(sql: string): Promise<any[]> };
  }

  type MergedPorts = MyPorts & CQRSPorts;

  it("should include custom ports fields", () => {
    expectTypeOf<MergedPorts["db"]>().toEqualTypeOf<{
      query(sql: string): Promise<any[]>;
    }>();
  });

  it("should include CQRS buses", () => {
    expectTypeOf<MergedPorts["commandBus"]>().toEqualTypeOf<CommandBus>();
  });
});
```
