import { Command, CommandBus } from "../../cqrs";

export class InMemoryCommandBus implements CommandBus {
  public async dispatch(command: Command): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
