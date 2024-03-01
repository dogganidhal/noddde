import { Command, TargetedCommand } from "./command";

export interface CommandBus {
  dispatch: <TCommand extends Command>(
    name: string,
    command: TCommand,
  ) => Promise<TCommand extends TargetedCommand ? void : string>;
}

export const getCommandBus = (): CommandBus => {
  throw new Error("Not implemented");
};
