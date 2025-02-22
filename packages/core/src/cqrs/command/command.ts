export interface Command {
  name: string;
  payload?: any;
}

export interface LiveAggregateCommand<TID> extends Command {
  targetAggregateId: TID;
}

export type CreateAggregateCommand = Command;

export type RoutedCommand = LiveAggregateCommand<any> | CreateAggregateCommand;

export type StandaloneCommand = Command;

export type CommandResult<TCommand extends Command> =
  TCommand extends RoutedCommand
    ? TCommand extends LiveAggregateCommand<infer TID>
      ? TID
      : void
    : void;
