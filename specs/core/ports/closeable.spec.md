---
title: "Closeable & BackgroundProcess"
module: ports/closeable
source_file: packages/core/src/ports/closeable.ts, packages/core/src/ports/background-process.ts
status: implemented
exports:
  - Closeable
  - isCloseable
  - BackgroundProcess
depends_on: []
docs:
  - running/domain-configuration.mdx
---

# Closeable & BackgroundProcess

> Lifecycle interfaces for infrastructure components that hold resources requiring cleanup. `Closeable` represents any component with resources to release (database connections, file handles, timers). `BackgroundProcess` represents a long-running background task that can be drained during shutdown. `isCloseable` is a type guard for runtime auto-detection of closeable adapters.

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
```

- `Closeable` is the primary interface for resource cleanup. ORM adapters (Drizzle, Prisma, TypeORM) implement it to close database connections. User infrastructure can also implement it.
- `isCloseable` checks for the presence of a `close` method that is a function. It does not verify the return type at runtime.
- `BackgroundProcess` is used internally by the engine (e.g., `OutboxRelay`). It is not exposed in `DomainWiring` — the Domain manages its background processes directly.

## Behavioral Requirements

1. **isCloseable returns true for objects with a close method** -- `isCloseable(value)` returns `true` when `value` is a non-null object with a `close` property that is a function.
2. **isCloseable returns false for non-objects** -- `isCloseable(null)`, `isCloseable(undefined)`, `isCloseable(42)`, `isCloseable("string")` all return `false`.
3. **isCloseable returns false for objects without close** -- `isCloseable({})` and `isCloseable({ foo: 1 })` return `false`.
4. **isCloseable returns false for objects where close is not a function** -- `isCloseable({ close: "not a function" })` returns `false`.

## Invariants

- `Closeable.close()` is always async (returns `Promise<void>`).
- `Closeable.close()` is idempotent: calling it after the first successful close is a no-op.
- `BackgroundProcess.drain()` is always async (returns `Promise<void>`).
- `BackgroundProcess.drain()` is idempotent: calling it after the first successful drain is a no-op.
- `isCloseable` is a pure function with no side effects.

## Edge Cases

- **Object with close as an arrow function** -- `isCloseable({ close: () => Promise.resolve() })` returns `true`.
- **Object with close as a bound method** -- `isCloseable(instance)` where instance has a `close` method returns `true`.
- **Class instance** -- `isCloseable(new SomeCloseable())` returns `true` when the class implements `Closeable`.
- **Proxy or Reflect** -- `isCloseable` uses standard property access; proxied objects with `close` return `true`.

## Integration Points

- **Domain.shutdown()** -- Scans resolved adapters values for `Closeable` via `isCloseable()` and calls `close()` during shutdown.
- **ORM adapters** -- Drizzle, Prisma, TypeORM persistence implementations implement `Closeable` to close database pools/connections.
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
