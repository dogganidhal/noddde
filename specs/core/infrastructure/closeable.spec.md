---
title: "Closeable, Connectable, BackgroundProcess & BrokerResilience"
module: infrastructure/closeable
source_file: packages/core/src/infrastructure/closeable.ts, packages/core/src/infrastructure/connectable.ts, packages/core/src/infrastructure/background-process.ts
status: ready
exports:
  - Closeable
  - isCloseable
  - Connectable
  - isConnectable
  - BackgroundProcess
  - BrokerResilience
depends_on: []
docs:
  - running/domain-configuration.mdx
  - running/event-bus-adapters.mdx
---

# Closeable, Connectable, BackgroundProcess & BrokerResilience

> Lifecycle interfaces for infrastructure components. `Closeable` represents any component with resources to release (database connections, file handles, timers). `Connectable` represents any component that requires an explicit async connection step before use (message brokers, databases). `BackgroundProcess` represents a long-running background task that can be drained during shutdown. `isCloseable` and `isConnectable` are type guards for runtime auto-detection. `BrokerResilience` is a shared configuration type for connection retry behavior across all message broker adapters.

## Type Contract

```ts
/**
 * Interface for infrastructure components that hold resources requiring
 * cleanup (database connections, file handles, timers, etc.).
 *
 * Implementations must ensure `close()` is idempotent: calling it
 * multiple times has no additional effect after the first call.
 */
interface Closeable {
  /**
   * Releases all resources held by this component.
   * After `close()` resolves, the component must not be used.
   * Idempotent: subsequent calls resolve immediately.
   */
  close(): Promise<void>;
}

/**
 * Runtime type guard for detecting Closeable implementations.
 * Used by Domain.shutdown() to auto-discover infrastructure
 * components that need cleanup.
 */
function isCloseable(value: unknown): value is Closeable;

/**
 * Interface for infrastructure components that require an explicit
 * async connection step before use (message brokers, databases, etc.).
 *
 * Implementations must ensure `connect()` is idempotent: calling it
 * multiple times has no additional effect after the first call.
 */
interface Connectable {
  /**
   * Establishes the connection to the external resource.
   * After `connect()` resolves, the component is ready for use.
   * Idempotent: subsequent calls resolve immediately.
   */
  connect(): Promise<void>;
}

/**
 * Runtime type guard for detecting Connectable implementations.
 * Used by Domain.init() to auto-connect buses after the buses()
 * factory returns them.
 */
function isConnectable(value: unknown): value is Connectable;

/**
 * Interface for background processes that can be drained during shutdown.
 * Examples: outbox relay, event replay workers, scheduled cleanup jobs.
 *
 * During graceful shutdown, the domain calls `drain()` to signal
 * that no new work should be accepted and waits for in-flight work
 * to complete.
 */
interface BackgroundProcess {
  /**
   * Signals the process to stop accepting new work and waits for
   * all in-flight operations to complete.
   *
   * Must resolve within a reasonable time. The domain may enforce
   * a timeout externally.
   *
   * Idempotent: subsequent calls resolve immediately.
   */
  drain(): Promise<void>;
}

/**
 * Shared retry/resilience configuration for Connectable infrastructure
 * components (message brokers, databases). Provides a consistent shape
 * across all adapters for connection retry behavior.
 *
 * Each adapter maps these fields to its broker-specific client options.
 * Fields that don't apply to a particular broker are silently ignored.
 */
interface BrokerResilience {
  /**
   * Maximum number of connection attempts.
   * Use -1 for infinite retries (e.g., NATS default behavior).
   * Adapter-specific defaults vary (Kafka: 6, NATS: -1, RabbitMQ: 3).
   */
  maxAttempts?: number;
  /**
   * Initial delay between retries in milliseconds.
   * For brokers with exponential backoff (Kafka, RabbitMQ), this is the
   * base delay that doubles on each attempt. For brokers with fixed
   * intervals (NATS), this is the constant delay between attempts.
   * Adapter-specific defaults vary (Kafka: 300, NATS: 2000, RabbitMQ: 1000).
   */
  initialDelayMs?: number;
  /**
   * Maximum delay between retries in milliseconds (caps exponential backoff).
   * Ignored by brokers that use fixed intervals (e.g., NATS).
   * Adapter-specific defaults vary (Kafka: 30000, RabbitMQ: 30000).
   */
  maxDelayMs?: number;
  /**
   * Maximum number of delivery attempts per message before giving up.
   * When a consumer handler fails repeatedly, this limits redelivery to
   * prevent poison messages from blocking the queue/partition indefinitely.
   * After `maxRetries` delivery attempts, the message is discarded (acked/terminated).
   * Adapter mapping: Kafka = consumer-side tracking via headers,
   * NATS = `maxDeliver` on JetStream consumer, RabbitMQ = delivery count tracking.
   * Default: undefined (no limit — infinite redelivery, legacy behavior).
   */
  maxRetries?: number;
}
```

- `Closeable` is the primary interface for resource cleanup. ORM adapters (Drizzle, Prisma, TypeORM) implement it to close database connections. User infrastructure can also implement it.
- `isCloseable` checks for the presence of a `close` method that is a function. It does not verify the return type at runtime.
- `Connectable` is the mirror of `Closeable` for connection establishment. Message broker adapters (Kafka, NATS, RabbitMQ) implement it. `Domain.init()` auto-calls `connect()` on buses that implement `Connectable`.
- `isConnectable` checks for the presence of a `connect` method that is a function. Same structural check pattern as `isCloseable`.
- `BackgroundProcess` is used internally by the engine (e.g., `OutboxRelay`). It is not exposed in `DomainWiring` — the Domain manages its background processes directly.
- `BrokerResilience` is a plain configuration interface (no runtime behavior). It provides a normalized shape for connection retry config so all broker adapters expose the same fields (`maxAttempts`, `initialDelayMs`, `maxDelayMs`) instead of broker-specific naming. Each adapter maps these fields to its client library's native options.

## Behavioral Requirements

1. **isCloseable returns true for objects with a close method** -- `isCloseable(value)` returns `true` when `value` is a non-null object with a `close` property that is a function.
2. **isCloseable returns false for non-objects** -- `isCloseable(null)`, `isCloseable(undefined)`, `isCloseable(42)`, `isCloseable("string")` all return `false`.
3. **isCloseable returns false for objects without close** -- `isCloseable({})` and `isCloseable({ foo: 1 })` return `false`.
4. **isCloseable returns false for objects where close is not a function** -- `isCloseable({ close: "not a function" })` returns `false`.
5. **isConnectable returns true for objects with a connect method** -- `isConnectable(value)` returns `true` when `value` is a non-null object with a `connect` property that is a function.
6. **isConnectable returns false for non-objects** -- `isConnectable(null)`, `isConnectable(undefined)`, `isConnectable(42)`, `isConnectable("string")` all return `false`.
7. **isConnectable returns false for objects without connect** -- `isConnectable({})` and `isConnectable({ foo: 1 })` return `false`.
8. **isConnectable returns false for objects where connect is not a function** -- `isConnectable({ connect: "not a function" })` returns `false`.

## Invariants

- `Closeable.close()` is always async (returns `Promise<void>`).
- `Closeable.close()` is idempotent: calling it after the first successful close is a no-op.
- `Connectable.connect()` is always async (returns `Promise<void>`).
- `Connectable.connect()` is idempotent: calling it when already connected is a no-op.
- `BackgroundProcess.drain()` is always async (returns `Promise<void>`).
- `BackgroundProcess.drain()` is idempotent: calling it after the first successful drain is a no-op.
- `isCloseable` is a pure function with no side effects.
- `isConnectable` is a pure function with no side effects.
- `BrokerResilience` is a plain interface with all optional fields — no runtime behavior, no defaults (adapters supply defaults).

## Edge Cases

- **Object with close as an arrow function** -- `isCloseable({ close: () => Promise.resolve() })` returns `true`.
- **Object with close as a bound method** -- `isCloseable(instance)` where instance has a `close` method returns `true`.
- **Class instance** -- `isCloseable(new SomeCloseable())` returns `true` when the class implements `Closeable`.
- **Proxy or Reflect** -- `isCloseable` uses standard property access; proxied objects with `close` return `true`.

## Integration Points

- **Domain.shutdown()** -- Scans resolved infrastructure values for `Closeable` via `isCloseable()` and calls `close()` during shutdown.
- **Domain.init()** -- After resolving CQRS buses, scans each bus for `Connectable` via `isConnectable()` and calls `connect()` (fail-fast on connection errors).
- **ORM adapters** -- Drizzle, Prisma, TypeORM persistence implementations implement `Closeable` to close database pools/connections.
- **Message broker adapters** -- Kafka, NATS, RabbitMQ EventBus implementations implement `Connectable` to establish broker connections during wiring. All three accept `BrokerResilience` via a `resilience` config field for connection retry behavior.
- **OutboxRelay** -- Implements `BackgroundProcess` so Domain can drain it during shutdown.

## Test Scenarios

### isCloseable returns true for objects with a close function

```ts
import { describe, it, expect } from "vitest";
import { isCloseable } from "@noddde/core";

describe("isCloseable", () => {
  it("should return true for objects with a close function", () => {
    const closeable = { close: async () => {} };
    expect(isCloseable(closeable)).toBe(true);
  });
});
```

### isCloseable returns false for null and undefined

```ts
import { describe, it, expect } from "vitest";
import { isCloseable } from "@noddde/core";

describe("isCloseable", () => {
  it("should return false for null and undefined", () => {
    expect(isCloseable(null)).toBe(false);
    expect(isCloseable(undefined)).toBe(false);
  });
});
```

### isCloseable returns false for primitives

```ts
import { describe, it, expect } from "vitest";
import { isCloseable } from "@noddde/core";

describe("isCloseable", () => {
  it("should return false for primitives", () => {
    expect(isCloseable(42)).toBe(false);
    expect(isCloseable("string")).toBe(false);
    expect(isCloseable(true)).toBe(false);
  });
});
```

### isCloseable returns false for objects without close

```ts
import { describe, it, expect } from "vitest";
import { isCloseable } from "@noddde/core";

describe("isCloseable", () => {
  it("should return false for objects without a close property", () => {
    expect(isCloseable({})).toBe(false);
    expect(isCloseable({ foo: 1 })).toBe(false);
  });
});
```

### isCloseable returns false when close is not a function

```ts
import { describe, it, expect } from "vitest";
import { isCloseable } from "@noddde/core";

describe("isCloseable", () => {
  it("should return false when close is not a function", () => {
    expect(isCloseable({ close: "not a function" })).toBe(false);
    expect(isCloseable({ close: 42 })).toBe(false);
    expect(isCloseable({ close: null })).toBe(false);
  });
});
```

### Closeable interface has the correct shape

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Closeable, BackgroundProcess } from "@noddde/core";

describe("Closeable & BackgroundProcess Interfaces", () => {
  it("should have close returning Promise<void>", () => {
    expectTypeOf<Closeable["close"]>().toBeFunction();
    expectTypeOf<Closeable["close"]>().returns.toMatchTypeOf<Promise<void>>();
  });

  it("should have drain returning Promise<void>", () => {
    expectTypeOf<BackgroundProcess["drain"]>().toBeFunction();
    expectTypeOf<BackgroundProcess["drain"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});
```

### isCloseable detects class instances implementing Closeable

```ts
import { describe, it, expect } from "vitest";
import type { Closeable } from "@noddde/core";
import { isCloseable } from "@noddde/core";

describe("isCloseable", () => {
  it("should detect class instances that implement Closeable", () => {
    class DatabasePool implements Closeable {
      async close(): Promise<void> {}
    }

    expect(isCloseable(new DatabasePool())).toBe(true);
  });
});
```

### isConnectable returns true for objects with a connect function

```ts
import { describe, it, expect } from "vitest";
import { isConnectable } from "@noddde/core";

describe("isConnectable", () => {
  it("should return true for objects with a connect function", () => {
    const connectable = { connect: async () => {} };
    expect(isConnectable(connectable)).toBe(true);
  });
});
```

### isConnectable returns false for null and undefined

```ts
import { describe, it, expect } from "vitest";
import { isConnectable } from "@noddde/core";

describe("isConnectable", () => {
  it("should return false for null and undefined", () => {
    expect(isConnectable(null)).toBe(false);
    expect(isConnectable(undefined)).toBe(false);
  });
});
```

### isConnectable returns false for primitives

```ts
import { describe, it, expect } from "vitest";
import { isConnectable } from "@noddde/core";

describe("isConnectable", () => {
  it("should return false for primitives", () => {
    expect(isConnectable(42)).toBe(false);
    expect(isConnectable("string")).toBe(false);
    expect(isConnectable(true)).toBe(false);
  });
});
```

### isConnectable returns false for objects without connect

```ts
import { describe, it, expect } from "vitest";
import { isConnectable } from "@noddde/core";

describe("isConnectable", () => {
  it("should return false for objects without a connect property", () => {
    expect(isConnectable({})).toBe(false);
    expect(isConnectable({ foo: 1 })).toBe(false);
  });
});
```

### isConnectable returns false when connect is not a function

```ts
import { describe, it, expect } from "vitest";
import { isConnectable } from "@noddde/core";

describe("isConnectable", () => {
  it("should return false when connect is not a function", () => {
    expect(isConnectable({ connect: "not a function" })).toBe(false);
    expect(isConnectable({ connect: 42 })).toBe(false);
    expect(isConnectable({ connect: null })).toBe(false);
  });
});
```

### Connectable interface has the correct shape

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Connectable } from "@noddde/core";

describe("Connectable Interface", () => {
  it("should have connect returning Promise<void>", () => {
    expectTypeOf<Connectable["connect"]>().toBeFunction();
    expectTypeOf<Connectable["connect"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});
```

### isConnectable detects class instances implementing Connectable

```ts
import { describe, it, expect } from "vitest";
import type { Connectable } from "@noddde/core";
import { isConnectable } from "@noddde/core";

describe("isConnectable", () => {
  it("should detect class instances that implement Connectable", () => {
    class KafkaBus implements Connectable {
      async connect(): Promise<void> {}
    }

    expect(isConnectable(new KafkaBus())).toBe(true);
  });
});
```

### BrokerResilience interface has the correct shape

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { BrokerResilience } from "@noddde/core";

describe("BrokerResilience", () => {
  it("should have all optional fields with correct types", () => {
    expectTypeOf<BrokerResilience>().toHaveProperty("maxAttempts");
    expectTypeOf<BrokerResilience>().toHaveProperty("initialDelayMs");
    expectTypeOf<BrokerResilience>().toHaveProperty("maxDelayMs");
    expectTypeOf<BrokerResilience>().toHaveProperty("maxRetries");

    // All fields are optional
    const empty: BrokerResilience = {};
    expectTypeOf(empty).toMatchTypeOf<BrokerResilience>();

    // All fields accept numbers
    const full: BrokerResilience = {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      maxRetries: 3,
    };
    expectTypeOf(full).toMatchTypeOf<BrokerResilience>();
  });
});
```
