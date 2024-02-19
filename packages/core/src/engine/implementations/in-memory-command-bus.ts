import { Command, CommandBus, TargetedCommand } from "../../cqrs";
import { VEngine } from "../index";

export class InMemoryCommandBus implements CommandBus {
  private readonly commandHandlerMap: Map<
    string,
    (command: Command) => void | Promise<string>
  > = new Map();

  constructor(private readonly engine: VEngine) {}

  public dispatch<TCommand extends Command>(
    name: string,
    command: TCommand,
  ): TCommand extends TargetedCommand ? void : Promise<string> {
    const handler = this.commandHandlerMap.get(name);

    if (!handler) {
      throw new Error(`No handler found for command ${name}`);
    }

    const result = handler(command);

    if (!("targetAggregateId" in command)) {
      return undefined as TCommand extends TargetedCommand
        ? void
        : Promise<string>;
    }

    return result as TCommand extends TargetedCommand ? void : Promise<string>;
  }
}
