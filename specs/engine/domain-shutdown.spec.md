---
title: "Domain Graceful Shutdown"
module: engine/domain-shutdown
source_file: packages/engine/src/domain.ts
status: implemented
exports:
  - DomainShutdownError
  - ShutdownOptions
depends_on:
  - engine/domain
  - infrastructure/closeable
  - engine/outbox-relay
  - engine/implementations/ee-event-bus
docs:
  - running/domain-configuration.mdx
---

# Domain Graceful Shutdown

> Adds a `shutdown()` method to the `Domain` class that orchestrates a graceful stop: reject new work, drain in-flight operations, drain the outbox relay, remove event listeners, and auto-close infrastructure that implements `Closeable`. Designed for production process shutdown (`SIGTERM`, rolling deploys).

## Type Contract

```ts
import type { Closeable } from "@noddde/core";

/**
 * Error thrown when a command or query is dispatched after
 * Domain.shutdown() has been called.
 */
class DomainShutdownError extends Error {
  constructor();
  readonly name: "DomainShutdownError";
}

/**
 * Configuration options for Domain.shutdown().
 */
interface ShutdownOptions {
  /**
   * Maximum time in milliseconds to wait for in-flight operations
   * and background processes to complete. After this timeout,
   * shutdown proceeds to resource cleanup regardless.
   *
   * @default 30_000 (30 seconds)
   */
  timeoutMs?: number;
}
```

The `Domain` class gains:

```ts
class Domain<TInfrastructure, TStandaloneCommand, TStandaloneQuery> {
  /**
   * Gracefully shuts down the domain:
   * 1. Stops accepting new commands and queries (DomainShutdownError).
   * 2. Waits for in-flight command executions and saga reactions to complete.
   * 3. Drains the outbox relay (if configured).
   * 4. Removes all event bus listeners.
   * 5. Auto-closes infrastructure implementing Closeable.
   *
   * Idempotent: calling shutdown() multiple times returns the same promise.
   *
   * @param options - Optional shutdown configuration.
   */
  shutdown(options?: ShutdownOptions): Promise<void>;
}
```

- `DomainShutdownError` is a standard `Error` subclass with `name` set to `"DomainShutdownError"`.
- `ShutdownOptions.timeoutMs` applies to the drain phases only. Resource cleanup (phases 4-5) always executes regardless of timeout.
- `shutdown()` is idempotent: the second call returns the same promise as the first.

## Behavioral Requirements

1. **shutdown rejects new commands** -- After `shutdown()` is called, `dispatchCommand()` throws `DomainShutdownError` synchronously (before any async work).
2. **shutdown rejects new queries** -- After `shutdown()` is called, `dispatchQuery()` throws `DomainShutdownError` synchronously.
3. **shutdown rejects new withUnitOfWork calls** -- After `shutdown()` is called, `withUnitOfWork()` throws `DomainShutdownError` synchronously.
4. **shutdown waits for in-flight operations** -- If commands, queries, or withUnitOfWork calls are in progress when `shutdown()` is called, shutdown waits for them to complete before proceeding. The entire cascade (command → events → projections → sagas → saga commands) is covered because event dispatch is synchronous within the operation.
5. **shutdown drains the outbox relay** -- If an outbox relay is configured, shutdown calls `drain()` on it, which stops the polling timer and processes remaining entries until empty.
6. **shutdown removes event bus listeners** -- After draining, calls `removeAllListeners()` on the event bus (if it supports it) to prevent stale event delivery.
7. **shutdown auto-discovers and closes Closeable infrastructure** -- Scans all resolved infrastructure components using `isCloseable()`. Calls `close()` on each in reverse discovery order. Discovery targets (in order): custom infrastructure values, CQRS buses, aggregate persistence, saga persistence, outbox store, snapshot stores, idempotency store.
8. **shutdown is idempotent** -- Calling `shutdown()` multiple times returns the same promise. The shutdown sequence executes only once.
9. **shutdown respects timeout** -- If in-flight operations or background process draining exceed `timeoutMs` (default 30000), shutdown proceeds to resource cleanup anyway.
10. **shutdown closes infrastructure even on timeout** -- Even if the drain phases time out, resource cleanup (removeAllListeners + close) still executes.
11. **in-flight commands complete normally** -- Commands that were dispatched before `shutdown()` complete their full lifecycle (persist, publish events, trigger projections/sagas) without interruption.
12. **close errors are swallowed** -- If a `Closeable.close()` throws during shutdown, the error is caught and shutdown continues with the remaining closeables.

## Invariants

- After `shutdown()` resolves, no new commands or queries can be dispatched.
- After `shutdown()` resolves, no event listeners remain on the event bus.
- After `shutdown()` resolves, all `Closeable` infrastructure has had `close()` called (best-effort).
- The outbox relay timer is always cleared during shutdown.
- Shutdown never interrupts or cancels in-flight operations — it only waits for them.

## Edge Cases

- **shutdown with no active operations** -- Resolves immediately after cleanup phases.
- **shutdown with no outbox configured** -- Skips relay drain phase.
- **shutdown with no Closeable infrastructure** -- Skips close phase.
- **shutdown called during init()** -- Undefined behavior (domain is not fully initialized).
- **shutdown called twice concurrently** -- Both calls return the same promise.
- **Closeable.close() throws** -- Error is caught, shutdown continues.
- **timeout of 0** -- Drain phases are skipped immediately; cleanup still runs.
- **All infrastructure is Closeable** -- All components are closed in reverse order.
- **Mixed Closeable and non-Closeable** -- Only Closeable components are closed.

## Integration Points

- **Domain.dispatchCommand()** -- Guarded by `_shuttingDown` flag at entry.
- **Domain.dispatchQuery()** -- Guarded by `_shuttingDown` flag at entry.
- **Domain.withUnitOfWork()** -- Guarded by `_shuttingDown` flag at entry.
- **OutboxRelay** -- `drain()` called during shutdown (implements `BackgroundProcess`).
- **EventEmitterEventBus** -- `removeAllListeners()` called during shutdown.
- **Closeable** -- Infrastructure auto-detected via `isCloseable()` and closed.

## Test Scenarios

### shutdown rejects new commands with DomainShutdownError

```ts
import { describe, it, expect } from "vitest";
import { wireDomain, defineDomain, DomainShutdownError } from "@noddde/engine";
import { defineAggregate } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should reject commands after shutdown", async () => {
    const Agg = defineAggregate({
      name: "Acc",
      initialState: { balance: 0 },
      commands: {
        Deposit: (cmd, state) => ({
          name: "Deposited",
          payload: { amount: cmd.payload.amount },
        }),
      },
      apply: {
        Deposited: (payload, state) => ({
          ...state,
          balance: state.balance + payload.amount,
        }),
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { Acc: Agg } },
        readModel: { projections: {} },
      }),
    );

    await domain.shutdown();

    await expect(
      domain.dispatchCommand({
        name: "Deposit",
        payload: { amount: 100 },
        targetAggregateId: "a1",
      }),
    ).rejects.toThrow(DomainShutdownError);
  });
});
```

### shutdown rejects new queries with DomainShutdownError

```ts
import { describe, it, expect } from "vitest";
import { wireDomain, defineDomain, DomainShutdownError } from "@noddde/engine";

describe("Domain.shutdown", () => {
  it("should reject queries after shutdown", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    await domain.shutdown();

    await expect(
      domain.dispatchQuery({ name: "GetBalance", payload: { id: "a1" } }),
    ).rejects.toThrow(DomainShutdownError);
  });
});
```

### shutdown waits for in-flight commands to complete

```ts
import { describe, it, expect, vi } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";
import { defineAggregate } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should wait for in-flight commands before resolving", async () => {
    let resolveCommand: () => void;
    const commandStarted = new Promise<void>((r) => {
      resolveCommand = r;
    });
    let commandBlocker: Promise<void>;
    const blocker = new Promise<void>((r) => {
      commandBlocker = new Promise<void>((resolve) => {
        r(); /* signal started */
      }); /* never mind, let's use a deferred */
    });

    // Use a deferred pattern for the command handler
    let unblock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      unblock = r;
    });
    let commandHandlerEntered = false;

    const Agg = defineAggregate({
      name: "SlowAgg",
      initialState: {},
      commands: {
        SlowCmd: async (cmd, state) => {
          commandHandlerEntered = true;
          await blockPromise;
          return { name: "Done", payload: {} };
        },
      },
      apply: {
        Done: (_payload, state) => state,
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { SlowAgg: Agg } },
        readModel: { projections: {} },
      }),
    );

    // Start command but don't await
    const commandPromise = domain.dispatchCommand({
      name: "SlowCmd",
      payload: {},
      targetAggregateId: "a1",
    });

    // Wait for handler to enter
    await vi.waitFor(() => expect(commandHandlerEntered).toBe(true));

    // Start shutdown — should not resolve yet
    let shutdownResolved = false;
    const shutdownPromise = domain.shutdown().then(() => {
      shutdownResolved = true;
    });

    // Give microtasks a chance
    await new Promise((r) => setTimeout(r, 50));
    expect(shutdownResolved).toBe(false);

    // Unblock the command
    unblock();
    await commandPromise;
    await shutdownPromise;

    expect(shutdownResolved).toBe(true);
  });
});
```

### shutdown is idempotent

```ts
import { describe, it, expect } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";

describe("Domain.shutdown", () => {
  it("should return the same promise when called twice", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    const p1 = domain.shutdown();
    const p2 = domain.shutdown();

    expect(p1).toBe(p2);

    await p1;
    await p2;
  });
});
```

### shutdown auto-discovers and closes Closeable infrastructure

```ts
import { describe, it, expect, vi } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";
import type { Closeable } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should call close() on infrastructure implementing Closeable", async () => {
    const closeFn = vi.fn(async () => {});

    interface MyInfra {
      db: { query: () => void } & Closeable;
    }

    const domain = await wireDomain<MyInfra>(
      defineDomain<MyInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          db: { query: () => {}, close: closeFn },
        }),
      },
    );

    await domain.shutdown();

    expect(closeFn).toHaveBeenCalledOnce();
  });
});
```

### shutdown closes closeables in reverse discovery order

```ts
import { describe, it, expect, vi } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";

describe("Domain.shutdown", () => {
  it("should close infrastructure in reverse order", async () => {
    const order: string[] = [];

    interface MyInfra {
      first: { close: () => Promise<void> };
      second: { close: () => Promise<void> };
    }

    const domain = await wireDomain<MyInfra>(
      defineDomain<MyInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          first: {
            close: async () => {
              order.push("first");
            },
          },
          second: {
            close: async () => {
              order.push("second");
            },
          },
        }),
      },
    );

    await domain.shutdown();

    expect(order).toEqual(["second", "first"]);
  });
});
```

### shutdown respects timeout for in-flight operations

```ts
import { describe, it, expect } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";
import { defineAggregate } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should proceed after timeout even if operations are still running", async () => {
    const Agg = defineAggregate({
      name: "NeverAgg",
      initialState: {},
      commands: {
        NeverCmd: async () => {
          await new Promise(() => {}); // never resolves
          return { name: "Done", payload: {} };
        },
      },
      apply: { Done: (_p, s) => s },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { NeverAgg: Agg } },
        readModel: { projections: {} },
      }),
    );

    // Start a command that will never complete
    const _commandPromise = domain.dispatchCommand({
      name: "NeverCmd",
      payload: {},
      targetAggregateId: "a1",
    });

    // Shutdown with very short timeout should resolve
    const start = Date.now();
    await domain.shutdown({ timeoutMs: 100 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
```

### shutdown proceeds even if closeable.close() throws

```ts
import { describe, it, expect, vi } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";

describe("Domain.shutdown", () => {
  it("should continue closing remaining infrastructure if one close() throws", async () => {
    const order: string[] = [];

    interface MyInfra {
      failing: { close: () => Promise<void> };
      healthy: { close: () => Promise<void> };
    }

    const domain = await wireDomain<MyInfra>(
      defineDomain<MyInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          failing: {
            close: async () => {
              order.push("failing");
              throw new Error("close failed");
            },
          },
          healthy: {
            close: async () => {
              order.push("healthy");
            },
          },
        }),
      },
    );

    // Should not throw
    await domain.shutdown();

    // Both should have been attempted
    expect(order).toContain("failing");
    expect(order).toContain("healthy");
  });
});
```

### commands dispatched before shutdown complete normally

```ts
import { describe, it, expect, vi } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";
import { defineAggregate } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should allow in-flight commands to complete successfully", async () => {
    let unblock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      unblock = r;
    });
    let handlerEntered = false;

    const Agg = defineAggregate({
      name: "CmdAgg",
      initialState: { done: false },
      commands: {
        DoWork: async () => {
          handlerEntered = true;
          await blockPromise;
          return { name: "WorkDone", payload: {} };
        },
      },
      apply: {
        WorkDone: (_p, _s) => ({ done: true }),
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { CmdAgg: Agg } },
        readModel: { projections: {} },
      }),
    );

    const cmdPromise = domain.dispatchCommand({
      name: "DoWork",
      payload: {},
      targetAggregateId: "a1",
    });

    await vi.waitFor(() => expect(handlerEntered).toBe(true));

    // Start shutdown while command is in-flight
    const shutdownPromise = domain.shutdown();

    // Unblock
    unblock();

    // Command should succeed
    const result = await cmdPromise;
    expect(result).toBe("a1");

    await shutdownPromise;
  });
});
```

### withUnitOfWork rejects after shutdown

```ts
import { describe, it, expect } from "vitest";
import { wireDomain, defineDomain, DomainShutdownError } from "@noddde/engine";

describe("Domain.shutdown", () => {
  it("should reject withUnitOfWork calls after shutdown", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    await domain.shutdown();

    await expect(domain.withUnitOfWork(async () => {})).rejects.toThrow(
      DomainShutdownError,
    );
  });
});
```

### shutdown with no active operations resolves immediately

```ts
import { describe, it, expect } from "vitest";
import { wireDomain, defineDomain } from "@noddde/engine";

describe("Domain.shutdown", () => {
  it("should resolve immediately when no operations are in-flight", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    const start = Date.now();
    await domain.shutdown();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
```

### DomainShutdownError has correct name and message

```ts
import { describe, it, expect } from "vitest";
import { DomainShutdownError } from "@noddde/engine";

describe("DomainShutdownError", () => {
  it("should have the correct name and message", () => {
    const error = new DomainShutdownError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DomainShutdownError");
    expect(error.message).toContain("shutting down");
  });
});
```

### shutdown drains outbox relay

```ts
import { describe, it, expect, vi } from "vitest";
import { wireDomain, defineDomain, InMemoryOutboxStore } from "@noddde/engine";
import { defineAggregate } from "@noddde/core";
import type { Event } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should drain the outbox relay during shutdown", async () => {
    const outboxStore = new InMemoryOutboxStore();

    const Agg = defineAggregate({
      name: "Acc",
      initialState: { balance: 0 },
      commands: {
        Deposit: (cmd, state) => ({
          name: "Deposited",
          payload: { amount: cmd.payload.amount },
        }),
      },
      apply: {
        Deposited: (payload, state) => ({
          ...state,
          balance: state.balance + payload.amount,
        }),
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { Acc: Agg } },
        readModel: { projections: {} },
      }),
      { outbox: { store: () => outboxStore } },
    );

    // Dispatch a command to produce events in the outbox
    await domain.dispatchCommand({
      name: "Deposit",
      payload: { amount: 100 },
      targetAggregateId: "a1",
    });

    // Manually add an unpublished entry to simulate relay backlog
    await outboxStore.save([
      {
        id: "relay-test",
        event: { name: "Deposited", payload: { amount: 50 } },
        createdAt: new Date().toISOString(),
        publishedAt: null,
      },
    ]);

    // Shutdown should drain remaining entries
    await domain.shutdown();

    const remaining = await outboxStore.loadUnpublished();
    expect(remaining).toHaveLength(0);
  });
});
```
