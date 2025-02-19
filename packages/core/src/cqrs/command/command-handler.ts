import {
  InferAggregateID,
  InferAggregateInfrastructure,
  InferAggregateState,
} from "../../ddd";
import {
  AggregateRoot,
  RoutedCommand,
  Infrastructure,
  LiveAggregateCommand,
  StandaloneCommand,
  CreateAggregateCommand,
} from "../../index";
import { CQRSInfrastructure } from "../../infrastructure";

export type LiveAggregateCommandHandler<
  TCommand extends LiveAggregateCommand<TAggregate>,
  TAggregate extends AggregateRoot,
> = (
  command: TCommand["payload"],
  state: InferAggregateState<TAggregate>,
  infrastructure: InferAggregateInfrastructure<TAggregate> & CQRSInfrastructure,
) => void | Promise<void>;

export type CreateAggregateCommandHandler<
  TCommand extends CreateAggregateCommand<TAggregate>,
  TAggregate extends AggregateRoot,
> = (
  command: TCommand["payload"],
  infrastructure: InferAggregateInfrastructure<TAggregate> & CQRSInfrastructure,
) => InferAggregateID<TAggregate> | Promise<InferAggregateID<TAggregate>>;

export type RoutedCommandHandler<
  TCommand extends RoutedCommand<TAggregate>,
  TAggregate extends AggregateRoot,
> =
  TCommand extends LiveAggregateCommand<TAggregate>
    ? LiveAggregateCommandHandler<TCommand, TAggregate>
    : CreateAggregateCommandHandler<TCommand, TAggregate>;

export type StandaloneCommandHandler<
  TInfrastructure extends Infrastructure,
  TCommand extends StandaloneCommand,
> = (
  command: TCommand,
  infrastructure: TInfrastructure & CQRSInfrastructure,
) => void | Promise<void>;
