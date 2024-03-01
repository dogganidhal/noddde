import { ExtractAggregateInfrastructure, ExtractAggregateState } from "../ddd";
import { AggregateRoot, Command, TargetedCommand } from "..";
import { CQRSInfrastructure } from "../infrastructure";

export type TargetedCommandHandler<
  TCommand extends Command,
  TAggregate extends AggregateRoot<any>,
> = (
  command: TCommand,
  state: ExtractAggregateState<TAggregate>,
  infrastructure: ExtractAggregateInfrastructure<TAggregate> &
    CQRSInfrastructure,
) => void | Promise<void>;

export type CreationCommandHandler<
  TCommand extends Command,
  TAggregate extends AggregateRoot<any>,
> = (
  command: TCommand,
  infrastructure: ExtractAggregateInfrastructure<TAggregate> &
    CQRSInfrastructure,
) =>
  | ExtractAggregateState<TAggregate>
  | Promise<ExtractAggregateState<TAggregate>>;

export type CommandHandler<
  TCommand extends Command,
  TAggregate extends AggregateRoot<any>,
> = TCommand extends TargetedCommand
  ? TargetedCommandHandler<TCommand, TAggregate>
  : CreationCommandHandler<TCommand, TAggregate>;
