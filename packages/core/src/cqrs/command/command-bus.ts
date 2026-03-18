/* eslint-disable no-unused-vars */
import { Command } from "./command";

/**
 * Dispatches commands to their registered handlers. The command bus routes
 * aggregate commands to the appropriate aggregate and standalone commands
 * to standalone command handlers.
 *
 * @see {@link InMemoryCommandBus} for the built-in in-memory implementation.
 */
export interface CommandBus {
  /** Dispatches a command for processing. */
  dispatch(command: Command): Promise<void>;
}
