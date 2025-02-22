import { Event, Infrastructure, RoutedCommand } from "..";
import { RoutedCommandHandler } from "../cqrs";
import { StatefulEventHandler, EventSourcingHandler } from "../edd";

type EventHandlerMap<TAggregate extends AggregateRoot> = {
  [EventName in InferAggregateEvents<TAggregate>["name"]]?: StatefulEventHandler<
    TAggregate,
    any
  >;
};
type EventSourcingHandlerMap<TAggregate extends AggregateRoot> = {
  [EventName in InferAggregateEvents<TAggregate>["name"]]?: EventSourcingHandler<
    TAggregate,
    any
  >;
};
type CommandHandlerMap<TCommand extends RoutedCommand> = {
  [CommandName in TCommand["name"]]: RoutedCommandHandler<TCommand, any>;
};

export type InferAggregateID<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<infer TID> ? TID : never;

export type InferAggregateState<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, infer TState> ? TState : never;

export type InferAggregateInfrastructure<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, any, infer TInfrastructure>
    ? TInfrastructure
    : never;

export type InferAggregateEvents<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, any, any, infer TEvents>
    ? TEvents
    : never;

export type InferAggregateCommands<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, any, any, any, infer TCommands>
    ? TCommands
    : never;

export interface AggregateRoot<
  TID = string,
  TState = any,
  TInfrastructure extends Infrastructure = Infrastructure,
  TEvents extends Event = Event,
  TCommands extends RoutedCommand = RoutedCommand,
> {
  commandHandlers?: CommandHandlerMap<TCommands>;
  eventHandlers?: EventHandlerMap<this>;
  eventSourcingHandlers?: EventSourcingHandlerMap<this>;
}
