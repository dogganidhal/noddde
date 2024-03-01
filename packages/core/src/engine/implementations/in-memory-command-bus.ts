import {
  Command,
  CommandBus,
  CommandHandler,
  CreationCommandHandler,
  isCreationCommand,
  TargetedCommand,
  TargetedCommandHandler,
} from "../../cqrs";
import { Domain } from "../index";

export class InMemoryCommandBus implements CommandBus {
  private readonly commandHandlerMap: Map<string, CommandHandler<any, any>> =
    new Map();

  constructor(private readonly domain: Domain<any>) {}

  public async dispatch<TCommand extends Command>(
    name: string,
    command: TCommand,
  ): Promise<TCommand extends TargetedCommand ? void : string> {
    const handler = this.commandHandlerMap.get(name);

    if (!handler) {
      throw new Error(`No handler found for command ${name}`);
    }

    if (isCreationCommand(command)) {
      return (await (handler as CreationCommandHandler<TCommand, any>)(
        command,
        this.domain.infrastructure,
      )) as TCommand extends TargetedCommand ? void : string;
    }

    const { targetAggregateId: aggregateId } = command as TargetedCommand;

    const aggregate = this.domain.aggregateDefinitions[name];

    if (!aggregate) {
      throw new Error(`Aggregate ${name} not recognized`);
    }

    const state = await this.domain.loadAggregate(name, aggregateId);

    if (!state) {
      throw new Error(`Aggregate ${name} with id ${aggregateId} not found`);
    }

    return (await (handler as TargetedCommandHandler<TCommand, any>)(
      command,
      state,
      this.domain.infrastructure,
    )) as TCommand extends TargetedCommand ? void : string;
  }
}
