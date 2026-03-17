import { Command, CommandBus } from "../../cqrs";

/**
 * In-memory {@link CommandBus} implementation that dispatches commands to
 * registered handlers within the same process.
 *
 * Suitable for development, testing, and single-process applications.
 */
export class InMemoryCommandBus implements CommandBus {
  public async dispatch(command: Command): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
