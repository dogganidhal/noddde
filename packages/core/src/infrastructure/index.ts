import { CommandBus, QueryBus } from "../cqrs";
import { EventBus } from "../edd";

export type { Closeable } from "./closeable";
export { isCloseable } from "./closeable";
export type { BackgroundProcess } from "./background-process";
export type { Logger, LogLevel } from "./logger";

/**
 * Base infrastructure type. Extend this interface to declare the external
 * dependencies your domain needs (repositories, clocks, API clients, etc.).
 *
 * @example
 * ```ts
 * interface MyInfrastructure extends Infrastructure {
 *   clock: { now(): Date };
 *   emailService: { send(to: string, body: string): Promise<void> };
 * }
 * ```
 */
export type Infrastructure = {};

/**
 * Infrastructure provided by the framework containing the three CQRS buses.
 * Automatically merged into the infrastructure available to standalone command handlers.
 */
export interface CQRSInfrastructure {
  /** Bus for dispatching commands to aggregates or standalone command handlers. */
  commandBus: CommandBus;
  /** Bus for publishing domain events to projections and event handlers. */
  eventBus: EventBus;
  /** Bus for dispatching queries to query handlers. */
  queryBus: QueryBus;
}
