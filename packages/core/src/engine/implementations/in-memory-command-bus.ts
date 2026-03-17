import { Command, CommandBus } from "../../cqrs";

/** Handler function type for command bus registration. */
type CommandHandler = (command: Command) => void | Promise<void>;

/**
 * In-memory {@link CommandBus} implementation that dispatches commands to
 * registered handlers within the same process.
 *
 * Commands are routed by their `name` field to a handler registered via
 * {@link register}. Only one handler per command name is allowed — registering
 * a duplicate throws immediately to surface configuration bugs.
 *
 * Suitable for development, testing, and single-process applications.
 */
export class InMemoryCommandBus implements CommandBus {
  private readonly handlers = new Map<string, CommandHandler>();

  /**
   * Registers a handler for a given command name.
   *
   * @param commandName - The command `name` to handle.
   * @param handler - The function to invoke when a matching command is dispatched.
   * @throws If a handler is already registered for the given command name.
   */
  public register(commandName: string, handler: CommandHandler): void {
    if (this.handlers.has(commandName)) {
      throw new Error(
        `Handler already registered for command: ${commandName}`,
      );
    }
    this.handlers.set(commandName, handler);
  }

  /**
   * Dispatches a command to its registered handler.
   *
   * @param command - The command to dispatch. Must have a `name` field matching a registered handler.
   * @returns A promise that resolves when the handler completes.
   * @throws If no handler is registered for the command name.
   * @throws If the handler throws synchronously or rejects asynchronously.
   */
  public async dispatch(command: Command): Promise<void> {
    const handler = this.handlers.get(command.name);
    if (!handler) {
      throw new Error(
        `No handler registered for command: ${command.name}`,
      );
    }
    await handler(command);
  }
}
