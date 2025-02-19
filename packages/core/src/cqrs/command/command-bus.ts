import { Command, CommandResult } from "./command";

export interface CommandBus {
  dispatch<TCommand extends Command>(
    command: TCommand,
  ): Promise<CommandResult<TCommand>>;
}
