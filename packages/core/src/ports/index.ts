import { CommandBus, QueryBus } from "../cqrs";
import { EventBus } from "../edd";
import type { Logger } from "./logger";

export type { Closeable } from "./closeable";
export { isCloseable } from "./closeable";
export type { BackgroundProcess } from "./background-process";
export type { Logger, LogLevel } from "./logger";

/**
 * Base port type. Extend this interface to declare the external
 * dependencies your domain needs (repositories, clocks, API clients, etc.).
 *
 * @example
 * ```ts
 * interface MyPorts extends Ports {
 *   clock: { now(): Date };
 *   emailService: { send(to: string, body: string): Promise<void> };
 * }
 * ```
 */
export type Ports = {};

/**
 * Framework-provided ports automatically available to all handlers.
 * Contains the framework logger and any future framework-level services.
 *
 * Merged into every handler's `ports` parameter by the engine.
 * Handlers can use `ports.logger` without declaring it in their
 * custom ports type.
 */
export interface FrameworkPorts {
  /** Framework logger instance. Use `child()` to create scoped loggers. */
  logger: Logger;
}

/**
 * Ports provided by the framework containing the three CQRS buses.
 * Automatically merged into the ports available to standalone command handlers.
 */
export interface CQRSPorts {
  /** Bus for dispatching commands to aggregates or standalone command handlers. */
  commandBus: CommandBus;
  /** Bus for publishing domain events to projections and event handlers. */
  eventBus: EventBus;
  /** Bus for dispatching queries to query handlers. */
  queryBus: QueryBus;
}
