---
title: "NodddeLogger & NoopLogger"
module: engine/logger
source_file: packages/engine/src/logger.ts
status: implemented
exports: [NodddeLogger, NoopLogger]
depends_on: [ports/logger]
docs:
  - ports/logging.mdx
---

# NodddeLogger & NoopLogger

> Default `Logger` implementations provided by `@noddde/engine`. `NodddeLogger` auto-detects the environment: colored human-readable output in development (TTY), newline-delimited JSON (NDJSON) in production or non-TTY environments (containers, CI, piped output). `NoopLogger` silently discards all messages. The Domain uses `NodddeLogger` at `'warn'` level by default.

## Type Contract

```ts
import type { Logger, LogLevel } from "@noddde/core";

class NodddeLogger implements Logger {
  constructor(level?: LogLevel, namespace?: string, pretty?: boolean);
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(namespace: string): Logger;
}

class NoopLogger implements Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(namespace: string): Logger;
}
```

## Behavioral Requirements

### NodddeLogger

1. **Environment auto-detection**: Pretty mode when `NODE_ENV` is not `'production'` AND `process.stdout.isTTY` is `true`. JSON mode otherwise.
2. **JSON mode (NDJSON)**: Single-line JSON per entry. Fields: `timestamp`, `level`, `namespace`, `message`, plus `data` merged as top-level keys.
3. **Pretty mode**: Spring Boot-inspired: `<dim timestamp> <colored bold LEVEL> <dim PID ---> <cyan [namespace]> message <logfmt key=value>`. Colors: DEBUG=magenta, INFO=green, WARN=yellow, ERROR=red.
4. **Stream routing**: `debug`/`info` → stdout. `warn`/`error` → stderr.
5. **Level filtering**: Numeric severity (debug=0, info=1, warn=2, error=3, silent=4). Emits only when severity >= threshold.
6. **Default level**: `'warn'`.
7. **Default namespace**: `'noddde'`.
8. **`child` composes namespaces**: Inherits parent level and output mode.
9. **Empty data**: `logger.info('msg', {})` treated as no data.

### NoopLogger

10. **Discards all messages**: All methods are empty no-ops.
11. **`child` returns itself**: Same instance, avoids allocation.

### Shared

12. **`'silent'` suppresses everything**.

## Invariants

- `NodddeLogger` never writes below its configured level.
- `NodddeLogger` always produces valid JSON in JSON mode.
- `NodddeLogger.child` returns a new instance.
- `NoopLogger.child` returns `this`.
- Both satisfy the `Logger` interface.

## Edge Cases

- **`NodddeLogger('silent')`**: Equivalent to `NoopLogger` but with level-check overhead.
- **Deeply nested children**: `noddde:a:b:c` — no depth limit.
- **Empty data**: Treated as no data in both modes.

## Integration Points

- `NodddeLogger` is the default when `DomainWiring.logger` is omitted.
- `NoopLogger` suppresses framework output in tests.
- Both exported from `@noddde/engine`.

## Test Scenarios

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
    expect(logger.child("anything")).toBe(logger);
  });
  it("should return same instance for nested children", () => {
    const logger = new NoopLogger();
    expect(logger.child("a").child("b").child("c")).toBe(logger);
  });
});
```

### NodddeLogger filters messages by level (JSON mode)

```ts
import { describe, it, expect, vi } from "vitest";
import { NodddeLogger } from "@noddde/engine";

describe("NodddeLogger level filtering (JSON mode)", () => {
  it("should suppress debug and info at warn level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("warn", "noddde", false);
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });
  it("should emit all levels at debug level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("debug", "noddde", false);
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(stdoutSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });
  it("should emit nothing at silent level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("silent", "noddde", false);
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
```

### NodddeLogger JSON output

```ts
import { describe, it, expect, vi } from "vitest";
import { NodddeLogger } from "@noddde/engine";

describe("NodddeLogger JSON output", () => {
  it("should write NDJSON with required fields", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("info", "noddde", false);
    logger.info("test message");
    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({
      level: "info",
      namespace: "noddde",
      message: "test message",
    });
    expect(parsed.timestamp).toBeDefined();
  });
  it("should include structured data as top-level fields", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("info", "noddde", false);
    logger.info("loaded", { aggregateId: "123", version: 5 });
    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({ aggregateId: "123", version: 5 });
  });
  it("should write warn and error to stderr", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("warn", "noddde", false);
    logger.warn("w");
    logger.error("e");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });
});
```

### NodddeLogger pretty output

```ts
import { describe, it, expect, vi } from "vitest";
import { NodddeLogger } from "@noddde/engine";

describe("NodddeLogger pretty output", () => {
  it("should include PID, separator, level, namespace", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("info", "noddde", true);
    logger.info("test message");
    const line = stdoutSpy.mock.calls[0]![0] as string;
    expect(line).toContain("INFO");
    expect(line).toContain("[noddde]");
    expect(line).toContain("---");
    expect(line).toContain(String(process.pid));
    expect(() => JSON.parse(line)).toThrow();
  });
  it("should format data as logfmt key=value", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const logger = new NodddeLogger("info", "noddde", true);
    logger.info("loaded", { aggregateId: "123", version: 5 });
    const line = stdoutSpy.mock.calls[0]![0] as string;
    expect(line).toContain("aggregateId=");
    expect(line).toContain('"123"');
    expect(line).toContain("version=");
  });
});
```

### NodddeLogger.child composes namespaces

```ts
import { describe, it, expect, vi } from "vitest";
import { NodddeLogger } from "@noddde/engine";

describe("NodddeLogger.child", () => {
  it("should compose namespace (JSON)", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const child = new NodddeLogger("info", "noddde", false).child("command");
    child.info("dispatching");
    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed.namespace).toBe("noddde:command");
  });
  it("should compose namespace (pretty)", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const child = new NodddeLogger("info", "noddde", true).child("command");
    child.info("dispatching");
    expect(stdoutSpy.mock.calls[0]![0] as string).toContain("[noddde:command]");
  });
  it("should inherit pretty mode", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const child = new NodddeLogger("info", "noddde", true).child("saga");
    child.info("msg");
    expect(() => JSON.parse(stdoutSpy.mock.calls[0]![0] as string)).toThrow();
  });
});
```
