import { ExtractAggregateInfrastructure, ExtractAggregateState } from "../ddd";
import { AggregateRoot, Command, TargetedCommand } from "..";
import { VInfrastructure } from "../infrastructure";

export type CommandHandler<
  TCommand extends Command,
  TAggregate extends AggregateRoot<any, any>,
> = TCommand extends TargetedCommand
  ? (
      command: TCommand,
      state: ExtractAggregateState<TAggregate>,
      infrastructure: ExtractAggregateInfrastructure<TAggregate> &
        VInfrastructure,
    ) => void | Promise<void>
  : (
      command: TCommand,
      infrastructure: ExtractAggregateInfrastructure<TAggregate> &
        VInfrastructure,
    ) =>
      | ExtractAggregateState<TAggregate>
      | Promise<ExtractAggregateState<TAggregate>>;
