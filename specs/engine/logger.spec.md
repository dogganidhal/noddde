---
title: "ConsoleLogger & NoopLogger"
module: engine/logger
source_file: packages/engine/src/logger.ts
status: implemented
exports: [ConsoleLogger, NoopLogger]
depends_on: [infrastructure/logger]
docs:
  - infrastructure/logging.mdx
---

# ConsoleLogger & NoopLogger

> Default `Logger` implementations provided by `@noddde/engine`. `ConsoleLogger` outputs to the global `console` with level filtering and namespace prefixing. `NoopLogger` silently discards all messages. The Domain uses `ConsoleLogger` at `'warn'` level by default, preserving the framework's current behavior of only showing in-memory fallback warnings.

## Type Contract

```ts
import type { Logger, LogLevel } from "@noddde/core";

/**
 * Console-based Logger implementation with level filtering and
 * namespace prefixing. Output goes through the global `console`
 * object using the matching method (console.debug, console.info,
 * console.warn, console.error).
 */
class ConsoleLogger implements Logger {
  /**
   * @param level - Minimum severity to emit. Defaults to 'warn'.
   * @param namespace - Prefix for all messages. Defaults to 'noddde'.
   */
  constructor(level?: LogLevel, namespace?: string);

  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(namespace: string): Logger;
}

/**
 * No-op Logger implementation. All methods are empty.
 * Equivalent to LogLevel 'silent' but avoids level-check overhead.
 */
class NoopLogger implements Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(namespace: string): Logger;
}
```

## Behavioral Requirements

1. **Level filtering**: `ConsoleLogger` uses numeric severity (debug=0, info=1, warn=2, error=3, silent=4). A message is emitted only if its severity >= the configured level's severity.
2. **Default level is `'warn'`**: Matches the framework's current behavior where only `console.warn` calls are visible.
3. **Default namespace is `'noddde'`**: Root logger prefix is `[noddde]`.
4. **Namespace prefixing**: All output is prefixed with `[namespace]`. Example: `[noddde] Using in-memory CQRS buses.`
5. **Console method mapping**: `debug` → `console.debug`, `info` → `console.info`, `warn` → `console.warn`, `error` → `console.error`.
6. **Structured data forwarding**: When `data` is provided and non-empty, it is passed as an additional argument to the console method.
7. **`child` composes namespaces**: `new ConsoleLogger('info', 'noddde').child('command')` produces a logger with namespace `'noddde:command'`. The child inherits the parent's level.
8. **NoopLogger discards all messages**: All four level methods are empty no-ops.
9. **NoopLogger.child returns itself**: Since all operations are no-ops, child loggers are the same instance (avoids unnecessary allocation).
10. **`'silent'` level suppresses everything**: A `ConsoleLogger` constructed with `'silent'` emits no output.

## Invariants

- `ConsoleLogger` never calls a console method below its configured level.
- `ConsoleLogger.child` always returns a new `ConsoleLogger` instance (not the same reference).
- `NoopLogger.child` always returns `this` (the same reference).
- Both implementations satisfy the `Logger` interface.

## Edge Cases

- **`ConsoleLogger('silent')`**: Functionally equivalent to `NoopLogger` but still performs level-check branching.
- **Deeply nested children**: `logger.child('a').child('b').child('c')` produces `[noddde:a:b:c]` — no depth limit.
- **Empty data object**: `logger.info('msg', {})` should NOT pass the empty object to console (treat as no data).
- **`data` with non-serializable values**: The Logger passes `data` through as-is — serialization is the consumer's responsibility.

## Integration Points

- `ConsoleLogger` is the default logger created by `Domain.init()` when `DomainWiring.logger` is omitted.
- `NoopLogger` is useful in tests to suppress framework output.
- Both are exported from `@noddde/engine` for direct use by consumers.

## Test Scenarios

### ConsoleLogger filters messages by level

```ts
import { describe, it, expect, vi } from "vitest";
import { ConsoleLogger } from "@noddde/engine";

describe("ConsoleLogger level filtering", () => {
  it("should suppress debug and info at warn level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new ConsoleLogger("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should emit all levels at debug level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new ConsoleLogger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should emit nothing at silent level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new ConsoleLogger("silent");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
```

### ConsoleLogger prefixes with namespace

```ts
import { describe, it, expect, vi } from "vitest";
import { ConsoleLogger } from "@noddde/engine";

describe("ConsoleLogger namespace prefixing", () => {
  it("should prefix messages with [noddde] by default", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = new ConsoleLogger("warn");
    logger.warn("test message");

    expect(warnSpy).toHaveBeenCalledWith("[noddde]", "test message");
  });

  it("should prefix with custom namespace", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = new ConsoleLogger("warn", "myapp");
    logger.warn("test message");

    expect(warnSpy).toHaveBeenCalledWith("[myapp]", "test message");
  });
});
```

### ConsoleLogger forwards structured data

```ts
import { describe, it, expect, vi } from "vitest";
import { ConsoleLogger } from "@noddde/engine";

describe("ConsoleLogger structured data", () => {
  it("should pass data as additional argument when non-empty", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = new ConsoleLogger("info");
    logger.info("loaded", { aggregateId: "123", version: 5 });

    expect(infoSpy).toHaveBeenCalledWith("[noddde]", "loaded", {
      aggregateId: "123",
      version: 5,
    });
  });

  it("should not pass empty data object", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = new ConsoleLogger("info");
    logger.info("loaded", {});

    expect(infoSpy).toHaveBeenCalledWith("[noddde]", "loaded");
  });

  it("should not pass data when omitted", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = new ConsoleLogger("info");
    logger.info("loaded");

    expect(infoSpy).toHaveBeenCalledWith("[noddde]", "loaded");
  });
});
```

### ConsoleLogger.child composes namespaces

```ts
import { describe, it, expect, vi } from "vitest";
import { ConsoleLogger } from "@noddde/engine";

describe("ConsoleLogger.child", () => {
  it("should create child with composed namespace", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const root = new ConsoleLogger("info");
    const child = root.child("command");
    child.info("dispatching");

    expect(infoSpy).toHaveBeenCalledWith("[noddde:command]", "dispatching");
  });

  it("should support deeply nested children", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const logger = new ConsoleLogger("debug")
      .child("command")
      .child("lifecycle");
    logger.debug("step");

    expect(debugSpy).toHaveBeenCalledWith("[noddde:command:lifecycle]", "step");
  });

  it("should inherit parent level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const child = new ConsoleLogger("warn").child("saga");
    child.debug("should not appear");
    child.warn("should appear");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[noddde:saga]", "should appear");
  });

  it("should return a new instance (not the same reference)", () => {
    const logger = new ConsoleLogger("info");
    const child = logger.child("test");
    expect(child).not.toBe(logger);
  });
});
```

### NoopLogger discards all messages

```ts
import { describe, it, expect, vi } from "vitest";
import { NoopLogger } from "@noddde/engine";

describe("NoopLogger", () => {
  it("should not call any console methods", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new NoopLogger();
    logger.debug("d", { key: "value" });
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
```

### NoopLogger.child returns same instance

```ts
import { describe, it, expect } from "vitest";
import { NoopLogger } from "@noddde/engine";

describe("NoopLogger.child", () => {
  it("should return the same NoopLogger instance", () => {
    const logger = new NoopLogger();
    const child = logger.child("anything");
    expect(child).toBe(logger);
  });

  it("should return same instance for nested children", () => {
    const logger = new NoopLogger();
    const nested = logger.child("a").child("b").child("c");
    expect(nested).toBe(logger);
  });
});
```

### Default constructor values

```ts
import { describe, it, expect, vi } from "vitest";
import { ConsoleLogger } from "@noddde/engine";

describe("ConsoleLogger defaults", () => {
  it("should default to warn level and noddde namespace", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = new ConsoleLogger();
    logger.debug("should not appear");
    logger.warn("should appear");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[noddde]", "should appear");
  });
});
```
