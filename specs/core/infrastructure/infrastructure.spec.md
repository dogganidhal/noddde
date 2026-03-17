---
title: "Infrastructure & CQRSInfrastructure"
module: infrastructure/index
source_file: packages/core/src/infrastructure/index.ts
status: ready
exports: [Infrastructure, CQRSInfrastructure]
depends_on: [cqrs/command/command-bus, cqrs/query/query-bus, edd/event-bus]
---

# Infrastructure & CQRSInfrastructure

> `Infrastructure` is the base type for all external dependencies in the framework. It is an empty object type (`{}`) that users extend to declare their domain's dependencies. `CQRSInfrastructure` is a framework-provided interface containing the three CQRS buses, automatically merged into infrastructure for standalone command handlers and saga event handlers.

## Type Contract

- **`Infrastructure`** is a type alias for `{}` (empty object type).
  - It serves as the base constraint for all infrastructure type parameters.
  - Users extend it by declaring interfaces that include their dependencies.
- **`CQRSInfrastructure`** is an interface with three fields:
  - `commandBus: CommandBus` -- for dispatching commands.
  - `eventBus: EventBus` -- for publishing events.
  - `queryBus: QueryBus` -- for dispatching queries.

## Behavioral Requirements

- `Infrastructure` being `{}` means any object type is assignable to it (it is the top of the infrastructure type hierarchy).
- `CQRSInfrastructure` provides the runtime-injected CQRS buses. It is merged with user infrastructure via intersection (`&`) in handlers that need bus access.
- The separation between `Infrastructure` and `CQRSInfrastructure` ensures that pure handlers (like aggregate command handlers) do not accidentally depend on CQRS buses, while orchestration handlers (standalone commands, sagas) get them.

## Invariants

- `Infrastructure` is exactly `{}` -- it has no required fields.
- Any interface extending `Infrastructure` is a valid infrastructure type.
- `CQRSInfrastructure` always has exactly three fields: `commandBus`, `eventBus`, `queryBus`.
- `CQRSInfrastructure` is NOT a subtype of `Infrastructure` per se -- it is a separate interface that gets intersected where needed.

## Edge Cases

- **Empty infrastructure**: Using `Infrastructure` directly means the handler gets no custom dependencies.
- **Infrastructure with overlapping bus names**: If a user declares `commandBus` in their custom infrastructure, the intersection with `CQRSInfrastructure` will merge the types (intersection of the field types).
- **`CQRSInfrastructure` as standalone**: Can be used as a type on its own for contexts that only need bus access.

## Integration Points

- `Infrastructure` is the base constraint for:
  - `EventHandler<TEvent, TInfrastructure extends Infrastructure>`
  - `QueryHandler<TInfrastructure extends Infrastructure, TQuery>`
  - `StandaloneCommandHandler<TInfrastructure extends Infrastructure, TCommand>`
  - `AggregateTypes["infrastructure"]`
  - `ProjectionTypes["infrastructure"]`
  - `SagaTypes["infrastructure"]`
- `CQRSInfrastructure` is merged via `&` in:
  - `StandaloneCommandHandler` second parameter: `TInfrastructure & CQRSInfrastructure`
  - `SagaEventHandler` third parameter: `TInfrastructure & CQRSInfrastructure`

## Test Scenarios

### Infrastructure is an empty object type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Infrastructure } from "@noddde/core";

describe("Infrastructure", () => {
  it("should be assignable from any object", () => {
    expectTypeOf<{ foo: string }>().toMatchTypeOf<Infrastructure>();
  });

  it("should be assignable from empty object", () => {
    expectTypeOf<{}>().toEqualTypeOf<Infrastructure>();
  });

  it("should allow extension via interface", () => {
    interface MyInfra extends Infrastructure {
      clock: { now(): Date };
    }
    expectTypeOf<MyInfra>().toMatchTypeOf<Infrastructure>();
    expectTypeOf<MyInfra["clock"]>().toEqualTypeOf<{ now(): Date }>();
  });
});
```

### CQRSInfrastructure contains the three buses

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { CQRSInfrastructure, CommandBus, EventBus, QueryBus } from "@noddde/core";

describe("CQRSInfrastructure", () => {
  it("should have commandBus", () => {
    expectTypeOf<CQRSInfrastructure["commandBus"]>().toEqualTypeOf<CommandBus>();
  });

  it("should have eventBus", () => {
    expectTypeOf<CQRSInfrastructure["eventBus"]>().toEqualTypeOf<EventBus>();
  });

  it("should have queryBus", () => {
    expectTypeOf<CQRSInfrastructure["queryBus"]>().toEqualTypeOf<QueryBus>();
  });
});
```

### Infrastructure intersection with CQRSInfrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Infrastructure, CQRSInfrastructure, CommandBus } from "@noddde/core";

describe("Infrastructure & CQRSInfrastructure intersection", () => {
  interface MyInfra extends Infrastructure {
    db: { query(sql: string): Promise<any[]> };
  }

  type MergedInfra = MyInfra & CQRSInfrastructure;

  it("should include custom infrastructure fields", () => {
    expectTypeOf<MergedInfra["db"]>().toEqualTypeOf<{
      query(sql: string): Promise<any[]>;
    }>();
  });

  it("should include CQRS buses", () => {
    expectTypeOf<MergedInfra["commandBus"]>().toEqualTypeOf<CommandBus>();
  });
});
```
