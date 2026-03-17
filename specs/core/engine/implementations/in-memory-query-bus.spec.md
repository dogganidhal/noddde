---
title: "InMemoryQueryBus"
module: engine/implementations/in-memory-query-bus
source_file: packages/core/src/engine/implementations/in-memory-query-bus.ts
status: ready
exports: [InMemoryQueryBus]
depends_on: [cqrs/query/query-bus, cqrs/query/query, cqrs/query/query-handler]
---

# InMemoryQueryBus

> In-memory QueryBus implementation that routes queries to registered handlers within the same process. Preserves the phantom `TResult` type from the `Query` generic, ensuring that `dispatch` returns the correctly typed result at compile time. Suitable for development, testing, and single-process applications.

## Type Contract

```ts
class InMemoryQueryBus implements QueryBus {
  dispatch<TQuery extends Query<any>>(query: TQuery): Promise<QueryResult<TQuery>>;
}
```

- Implements the `QueryBus` interface from `cqrs/query/query-bus`.
- The current source is a stub (`throw new Error("Method not implemented.")`). This spec defines the expected behavior once implemented.
- `dispatch` returns `Promise<QueryResult<TQuery>>` which extracts the phantom result type from the query, giving callers compile-time type safety on the return value.
- The bus must support handler registration so the Domain can wire projection query handlers and standalone query handlers at init time.

## Behavioral Requirements

1. **Handler registration** -- The bus must provide a mechanism to register a handler for a given query name. Only one handler per query name is allowed (each query has a single authoritative handler).
2. **Dispatch routing** -- `dispatch(query)` looks up the handler registered for `query.name` and invokes it with the query's payload (not the full query object, consistent with the `QueryHandler` type signature).
3. **Result forwarding** -- The value returned by the handler is returned (wrapped in a Promise) by `dispatch`. The runtime type should match the compile-time `QueryResult<TQuery>`.
4. **Async execution** -- `dispatch` awaits the handler if it returns a Promise, propagating both the resolved value and any rejection.
5. **No handler found** -- If no handler is registered for the dispatched query name, `dispatch` must throw a descriptive error (e.g., `"No handler registered for query: GetAccountById"`).
6. **Single handler constraint** -- Registering a second handler for the same query name should throw, signaling a configuration bug.

## Invariants

- The handler map is populated during `Domain.init()` and should not change after initialization.
- `dispatch` is the only public method required by the `QueryBus` interface. Registration is an implementation detail of `InMemoryQueryBus`.
- The bus does not cache or memoize query results. Each `dispatch` call invokes the handler fresh.

## Edge Cases

- **Query with no payload** -- Queries defined without payload (e.g., `{ name: "ListAllAccounts" }`) should pass `undefined` as the payload argument to the handler.
- **Handler returns `null` or `undefined`** -- These are valid return values (e.g., "not found" semantics). `dispatch` should forward them without transformation.
- **Handler throws** -- The error propagates as a rejected promise from `dispatch`.
- **Concurrent dispatches** -- Multiple queries dispatched concurrently should each invoke the handler independently. No queuing or serialization is applied.

## Integration Points

- **Domain.init()** -- The domain registers query handlers from projections (`Projection.queryHandlers`) and standalone query handlers from the read model configuration.
- **CQRSInfrastructure** -- This bus is provided as `queryBus` in the merged infrastructure object.
- **Standalone command handlers and saga handlers** -- May query the read model through this bus via `infrastructure.queryBus.dispatch(query)`.

## Test Scenarios

### dispatch routes query to registered handler and returns result

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";
import type { Query } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should invoke the handler and return its result", async () => {
    const bus = new InMemoryQueryBus();
    const expectedResult = { id: "acc-1", balance: 500 };

    // @ts-expect-error -- accessing internal registration API
    bus.register("GetAccountById", vi.fn().mockResolvedValue(expectedResult));

    type GetAccountByIdQuery = Query<{ id: string; balance: number }> & {
      name: "GetAccountById";
      payload: { id: string };
    };

    const query: GetAccountByIdQuery = {
      name: "GetAccountById",
      payload: { id: "acc-1" },
    };

    const result = await bus.dispatch(query);

    expect(result).toEqual(expectedResult);
  });
});
```

### dispatch throws when no handler is registered

```ts
import { describe, it, expect } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should throw when dispatching a query with no registered handler", async () => {
    const bus = new InMemoryQueryBus();

    await expect(
      bus.dispatch({ name: "UnknownQuery" }),
    ).rejects.toThrow(/no handler/i);
  });
});
```

### handler receives query payload not the full query object

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should pass the query payload to the handler", async () => {
    const bus = new InMemoryQueryBus();
    const handler = vi.fn().mockResolvedValue([]);

    // @ts-expect-error -- accessing internal registration API
    bus.register("ListAccounts", handler);

    await bus.dispatch({
      name: "ListAccounts",
      payload: { limit: 10, offset: 0 },
    });

    expect(handler).toHaveBeenCalledWith({ limit: 10, offset: 0 });
  });
});
```

### handler returning null is forwarded as-is

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should return null when the handler returns null", async () => {
    const bus = new InMemoryQueryBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("FindAccount", vi.fn().mockResolvedValue(null));

    const result = await bus.dispatch({
      name: "FindAccount",
      payload: { id: "nonexistent" },
    });

    expect(result).toBeNull();
  });
});
```

### dispatch propagates handler errors

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should propagate errors thrown by the query handler", async () => {
    const bus = new InMemoryQueryBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("BrokenQuery", () => {
      throw new Error("Database connection failed");
    });

    await expect(
      bus.dispatch({ name: "BrokenQuery" }),
    ).rejects.toThrow("Database connection failed");
  });
});
```

### query with no payload passes undefined to handler

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should pass undefined when the query has no payload", async () => {
    const bus = new InMemoryQueryBus();
    const handler = vi.fn().mockResolvedValue({ total: 42 });

    // @ts-expect-error -- accessing internal registration API
    bus.register("GetTotalCount", handler);

    await bus.dispatch({ name: "GetTotalCount" });

    expect(handler).toHaveBeenCalledWith(undefined);
  });
});
```

### duplicate handler registration throws

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("should throw when registering a second handler for the same query name", () => {
    const bus = new InMemoryQueryBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("GetAccountById", vi.fn());

    expect(() => {
      // @ts-expect-error -- accessing internal registration API
      bus.register("GetAccountById", vi.fn());
    }).toThrow(/already registered/i);
  });
});
```
