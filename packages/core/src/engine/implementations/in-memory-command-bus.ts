import { Command, CommandBus, CommandResult } from "../../cqrs";

export class InMemoryCommandBus implements CommandBus {
  constructor() {}

  public async dispatch<TCommand extends Command>(
    command: TCommand,
  ): Promise<CommandResult<TCommand>> {
    throw new Error("Method not implemented.");
  }
}
