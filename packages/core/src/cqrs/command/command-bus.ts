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

/**
 * Optional sub-interface for {@link CommandBus} implementations that
 * support local handler registration (e.g. {@link InMemoryCommandBus}).
 *
 * Not part of `CommandBus` itself: a remote/RPC command bus is a valid
 * `CommandBus` implementation that structurally cannot support local
 * registration. The domain engine checks for this interface structurally
 * on the bus supplied via `DomainWiring.buses` and fails loudly at init
 * if registration is required (aggregate/standalone command routing) but
 * unavailable.
 */
export interface CommandHandlerRegistry {
  /**
   * Registers a handler for a given command name.
   *
   * @param commandName - The command `name` to handle.
   * @param handler - The function to invoke when a matching command is dispatched.
   */
  register(
    commandName: string,
    handler: (command: Command) => void | Promise<void>,
  ): void;
}
