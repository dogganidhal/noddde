---
title: "Logger & LogLevel"
module: infrastructure/logger
source_file: packages/core/src/infrastructure/logger.ts
status: implemented
exports: [Logger, LogLevel]
depends_on: []
docs:
  - infrastructure/logging.mdx
---

# Logger & LogLevel

> `Logger` is the framework's logging interface. It defines four severity-level methods plus a `child` factory for namespace-scoped loggers. `LogLevel` is a string union type that controls which messages are emitted. Both are pure types with no runtime code — implementations live in `@noddde/engine`.

## Type Contract

```ts
/**
 * Log levels ordered by severity. `'silent'` suppresses all output.
 */
type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Framework logger interface. Implementations handle level filtering,
 * formatting, and output. The framework calls these methods at
 * instrumentation points throughout the engine.
 *
 * All methods accept a human-readable message and optional structured
 * data for machine-parseable context.
 */
interface Logger {
  /** Log a debug-level message. Used for verbose tracing (state loads, event details). */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Log an info-level message. Used for lifecycle events (domain init, saga bootstrap). */
  info(message: string, data?: Record<string, unknown>): void;
  /** Log a warn-level message. Used for non-fatal issues (in-memory fallbacks, retries). */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Log an error-level message. Used for failures (handler errors, rollbacks). */
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Creates a child logger with a narrower namespace.
   * The child inherits the parent's configuration but prepends
   * its namespace to all messages.
   *
   * @param namespace - The sub-namespace (e.g., 'command', 'saga').
   * @returns A new Logger scoped to the given namespace.
   */
  child(namespace: string): Logger;
}
```

## Behavioral Requirements

1. **`LogLevel` is a closed union** of exactly five string literals: `'debug'`, `'info'`, `'warn'`, `'error'`, `'silent'`.
2. **Logger methods are synchronous void** — all four level methods and `child` return synchronously. Logging must never block the domain pipeline.
3. **Structured data parameter** — the optional `data` parameter is typed as `Record<string, unknown>`, enabling structured logging without forcing a specific serialization format.
4. **`child` returns a `Logger`** — enabling recursive namespace composition (e.g., `logger.child('a').child('b')` is valid).

## Invariants

- `LogLevel` contains exactly five members — no more, no less.
- All four level methods on `Logger` have identical signatures: `(message: string, data?: Record<string, unknown>) => void`.
- `child` accepts a single `string` and returns `Logger`.
- `Logger` is an interface, not a class — any object satisfying the shape is a valid Logger.

## Edge Cases

- **Custom Logger implementations**: Users can provide any object matching the `Logger` interface (e.g., wrapping pino, winston, or a test spy).
- **`data` omitted**: All level methods work with just a message string.
- **Empty data object**: Passing `{}` is valid but semantically equivalent to omitting `data`.

## Integration Points

- `Logger` is used by `DomainWiring.logger` in `@noddde/engine` to configure framework logging.
- `LogLevel` is used by `NodddeLogger` constructor in `@noddde/engine` to set the severity threshold.
- `Logger.child` is called by the Domain during init to create scoped loggers for sub-components (command executor, saga executor, outbox relay).

## Test Scenarios

### LogLevel is a union of five string literals

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { LogLevel } from "@noddde/core";

describe("LogLevel", () => {
  it("should accept 'debug'", () => {
    expectTypeOf<"debug">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'info'", () => {
    expectTypeOf<"info">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'warn'", () => {
    expectTypeOf<"warn">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'error'", () => {
    expectTypeOf<"error">().toMatchTypeOf<LogLevel>();
  });

  it("should accept 'silent'", () => {
    expectTypeOf<"silent">().toMatchTypeOf<LogLevel>();
  });

  it("should not accept arbitrary strings", () => {
    expectTypeOf<"verbose">().not.toMatchTypeOf<LogLevel>();
  });
});
```

### Logger methods have correct signatures

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Logger } from "@noddde/core";

describe("Logger", () => {
  it("should have debug method with correct signature", () => {
    expectTypeOf<Logger["debug"]>().toBeFunction();
    expectTypeOf<Logger["debug"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["debug"]>().returns.toEqualTypeOf<void>();
  });

  it("should have info method with correct signature", () => {
    expectTypeOf<Logger["info"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["info"]>().returns.toEqualTypeOf<void>();
  });

  it("should have warn method with correct signature", () => {
    expectTypeOf<Logger["warn"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["warn"]>().returns.toEqualTypeOf<void>();
  });

  it("should have error method with correct signature", () => {
    expectTypeOf<Logger["error"]>().parameters.toEqualTypeOf<
      [message: string, data?: Record<string, unknown>]
    >();
    expectTypeOf<Logger["error"]>().returns.toEqualTypeOf<void>();
  });
});
```

### Logger.child returns a Logger

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Logger } from "@noddde/core";

describe("Logger.child", () => {
  it("should accept a string namespace and return Logger", () => {
    expectTypeOf<Logger["child"]>().parameters.toEqualTypeOf<
      [namespace: string]
    >();
    expectTypeOf<Logger["child"]>().returns.toEqualTypeOf<Logger>();
  });

  it("should allow chained child calls", () => {
    type ChildReturn = ReturnType<ReturnType<Logger["child"]>["child"]>;
    expectTypeOf<ChildReturn>().toEqualTypeOf<Logger>();
  });
});
```

### Any matching object satisfies Logger

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Logger } from "@noddde/core";

describe("Logger structural typing", () => {
  it("should accept any object with matching methods", () => {
    const customLogger = {
      debug(_msg: string, _data?: Record<string, unknown>) {},
      info(_msg: string, _data?: Record<string, unknown>) {},
      warn(_msg: string, _data?: Record<string, unknown>) {},
      error(_msg: string, _data?: Record<string, unknown>) {},
      child(_ns: string): Logger {
        return this;
      },
    };
    expectTypeOf(customLogger).toMatchTypeOf<Logger>();
  });
});
```
