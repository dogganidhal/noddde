import {
  AggregateRoot,
  InferAggregateCommandNames,
  InferAggregateID,
} from "../ddd";

export interface Command<TCommandNames extends string | symbol = string> {
  name: TCommandNames;
  payload?: any;
}

export interface LiveAggregateCommand<TAggregate extends AggregateRoot>
  extends Command<InferAggregateCommandNames<TAggregate>> {
  targetAggregateId: InferAggregateID<TAggregate>;
}

export interface CreateAggregateCommand<TAggregate extends AggregateRoot>
  extends Command<InferAggregateCommandNames<TAggregate>> {}

export type RoutedCommand<TAggregate extends AggregateRoot> =
  | LiveAggregateCommand<TAggregate>
  | CreateAggregateCommand<TAggregate>;

export type ExternalCommand = Command;

export type CommandResult<TCommand extends Command> =
  TCommand extends RoutedCommand<infer TAggregate>
    ? TCommand extends CreateAggregateCommand<TAggregate>
      ? InferAggregateID<TAggregate>
      : void
    : void;
