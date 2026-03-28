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

/**
 * Console-based Logger implementation with level filtering and
 * namespace prefixing. All output goes through the global `console`
 * object using the matching method (console.debug, console.info,
 * console.warn, console.error).
 *
 * The namespace prefix follows the pattern `[noddde]` or
 * `[noddde:sub:namespace]` for child loggers.
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
