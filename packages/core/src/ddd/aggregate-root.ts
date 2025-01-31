import { Infrastructure } from "../index";
import { RoutedCommandHandler } from "../cqrs";
import { EventHandler, EventSourcingHandler } from "../edd";

type EventHandlerMap<
  TAggregate extends AggregateRoot,
  TEventName extends string | symbol = string | symbol,
> = {
  [EventName in TEventName]?: EventHandler<any, TAggregate>;
};
type EventSourcingHandlerMap<
  TAggregate extends AggregateRoot,
  TEventName extends string | symbol = string | symbol,
> = {
  [EventName in TEventName]?: EventSourcingHandler<any, TAggregate>;
};
type CommandHandlerMap<
  TAggregate extends AggregateRoot,
  TEventName extends string | symbol = string | symbol,
> = {
  [CommandName in TEventName]?: RoutedCommandHandler<any, TAggregate>;
};

export type InferAggregateID<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<infer TID> ? TID : never;

export type InferAggregateState<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, infer TState> ? TState : never;

export type InferAggregateInfrastructure<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, any, infer TInfrastructure>
    ? TInfrastructure
    : never;

export type InferAggregateEventNames<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, any, any, infer TEventNames>
    ? TEventNames
    : never;

export type InferAggregateCommandNames<TAggregate extends AggregateRoot> =
  TAggregate extends AggregateRoot<any, any, any, any, infer TCommandNames>
    ? TCommandNames
    : never;

export interface AggregateRoot<
  TID = string,
  TState = any,
  TInfrastructure extends Infrastructure = Infrastructure,
  TEventNames extends string | symbol = string | symbol,
  TCommandNames extends string | symbol = string | symbol,
> {
  commandHandlers?: CommandHandlerMap<this, TCommandNames>;
  eventHandlers?: EventHandlerMap<this, TEventNames>;
  eventSourcingHandlers?: EventSourcingHandlerMap<this, TEventNames>;
}
