import { Command, TargetedCommand } from "./command";

export interface CommandBus {
  dispatch: <TCommand extends Command>(
    name: string,
    command: TCommand,
  ) => TCommand extends TargetedCommand ? void : Promise<string>;
}

export const getCommandBus = (): CommandBus => {
  throw new Error("Not implemented");
};
