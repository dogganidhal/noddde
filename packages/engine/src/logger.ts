/* eslint-disable no-unused-vars */
import type { Logger, LogLevel } from "@noddde/core";

/** Numeric severity constants for level comparison. */
const DEBUG = 0;
const INFO = 1;
const WARN = 2;
const ERROR = 3;
const SILENT = 4;

const SEVERITY_MAP: Record<string, number> = {
  debug: DEBUG,
  info: INFO,
  warn: WARN,
  error: ERROR,
  silent: SILENT,
};

/** Maps log level strings to numeric severity. */
function severity(level: LogLevel): number {
  return SEVERITY_MAP[level] ?? WARN;
}

/** ANSI color codes for pretty-mode output. */
const RESET = "\x1b[0m";
const DIM = "\x1b[90m";
const CYAN = "\x1b[36m";

const LEVEL_COLORS: Record<string, string> = {
  debug: "\x1b[35m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const LEVEL_LABELS: Record<string, string> = {
  debug: "DEBUG",
  info: " INFO",
  warn: " WARN",
  error: "ERROR",
};

/**
 * Detects whether logs should be formatted as human-readable colored
 * text or as NDJSON. Returns `true` for pretty mode.
 *
 * Pretty mode is used when all of the following are true:
 * - `NODE_ENV` is not `'production'`
 * - `process.stdout` is a TTY (interactive terminal)
 *
 * Everything else (containers, CI, piped output, production) gets JSON.
 */
function detectPretty(): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  return process.stdout.isTTY === true;
}

/**
 * Default framework Logger with environment-aware output formatting.
 *
 * **Pretty mode** (development, TTY):
 * ```
 * 2026-03-28T12:00:00.000Z  WARN [noddde:domain] Using in-memory CQRS buses. { aggregateId: "123" }
 * ```
 * Colored by level — green for INFO, yellow for WARN, red for ERROR,
 * magenta for DEBUG. Namespace in cyan, timestamp and data in dim gray.
 *
 * **JSON mode** (production, non-TTY, CI, containers):
 * ```json
 * {"timestamp":"2026-03-28T12:00:00.000Z","level":"info","namespace":"noddde:command","message":"Command dispatched","aggregateId":"123"}
 * ```
 *
 * Environment detection:
 * - `NODE_ENV=production` → always JSON
 * - `stdout` is not a TTY (piped, container, CI) → JSON
 * - Otherwise → colored pretty output
 *
 * This is the default logger when `DomainWiring.logger` is omitted.
 */
export class StructuredLogger implements Logger {
  private readonly severityThreshold: number;
  private readonly pretty: boolean;

  constructor(
    private readonly level: LogLevel = "warn",
    private readonly namespace: string = "noddde",
    pretty?: boolean,
  ) {
    this.severityThreshold = severity(this.level);
    this.pretty = pretty ?? detectPretty();
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= DEBUG) {
      this.emit("debug", message, data);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= INFO) {
      this.emit("info", message, data);
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= WARN) {
      this.emit("warn", message, data);
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= ERROR) {
      this.emit("error", message, data);
    }
  }

  child(namespace: string): Logger {
    return new StructuredLogger(
      this.level,
      `${this.namespace}:${namespace}`,
      this.pretty,
    );
  }

  private emit(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const hasData = data !== undefined && Object.keys(data).length > 0;
    const timestamp = new Date().toISOString();

    if (this.pretty) {
      this.emitPretty(level, message, timestamp, hasData ? data : undefined);
    } else {
      this.emitJson(level, message, timestamp, hasData ? data : undefined);
    }
  }

  private emitJson(
    level: string,
    message: string,
    timestamp: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: Record<string, unknown> = {
      timestamp,
      level,
      namespace: this.namespace,
      message,
    };
    if (data) {
      Object.assign(entry, data);
    }
    const line = JSON.stringify(entry) + "\n";
    if (level === "warn" || level === "error") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  private emitPretty(
    level: string,
    message: string,
    timestamp: string,
    data?: Record<string, unknown>,
  ): void {
    const color = LEVEL_COLORS[level] ?? "";
    const label = LEVEL_LABELS[level] ?? level.toUpperCase();
    const dataStr = data ? ` ${DIM}${JSON.stringify(data)}${RESET}` : "";
    const line = `${DIM}${timestamp}${RESET} ${color}${label}${RESET} ${CYAN}[${this.namespace}]${RESET} ${message}${dataStr}\n`;
    if (level === "warn" || level === "error") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }
}

/**
 * Console-based Logger implementation with level filtering and
 * namespace prefixing. All output goes through the global `console`
 * object using the matching method (console.debug, console.info,
 * console.warn, console.error).
 *
 * @deprecated Use {@link StructuredLogger} instead — it auto-detects
 * the environment and produces colored output in development.
 */
export class ConsoleLogger implements Logger {
  private readonly severityThreshold: number;

  constructor(
    private readonly level: LogLevel = "warn",
    private readonly namespace: string = "noddde",
  ) {
    this.severityThreshold = severity(this.level);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= DEBUG) {
      this.log("debug", message, data);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= INFO) {
      this.log("info", message, data);
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= WARN) {
      this.log("warn", message, data);
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (this.severityThreshold <= ERROR) {
      this.log("error", message, data);
    }
  }

  child(namespace: string): Logger {
    return new ConsoleLogger(this.level, `${this.namespace}:${namespace}`);
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const prefix = `[${this.namespace}]`;
    if (data !== undefined && Object.keys(data).length > 0) {
      console[level](prefix, message, data);
    } else {
      console[level](prefix, message);
    }
  }
}

/**
 * No-op Logger implementation. All methods are empty.
 * Equivalent to LogLevel 'silent' but avoids the overhead of
 * level-check branching.
 */
export class NoopLogger implements Logger {
  debug(_message: string, _data?: Record<string, unknown>): void {}
  info(_message: string, _data?: Record<string, unknown>): void {}
  warn(_message: string, _data?: Record<string, unknown>): void {}
  error(_message: string, _data?: Record<string, unknown>): void {}
  child(_namespace: string): Logger {
    return this;
  }
}
