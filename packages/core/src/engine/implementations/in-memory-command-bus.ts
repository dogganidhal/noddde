import { Command, CommandBus, CommandResult } from "../../cqrs";
import { Domain } from "../index";

export class InMemoryCommandBus implements CommandBus {
  constructor(private readonly domain: Domain<any>) {}

  public async dispatch<TCommand extends Command>(
    command: TCommand,
  ): Promise<CommandResult<TCommand>> {
    throw new Error("Method not implemented.");
  }
}
