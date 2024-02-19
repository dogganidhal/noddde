import { Infrastructure } from "../index";
import { CommandHandler } from "../cqrs";
import { EventHandler } from "../edd";

type EventHandlerMap<TAggregate extends AggregateRoot<any, any>> = Record<
  string | symbol,
  EventHandler<any, TAggregate>
>;
type CommandHandlerMap<TAggregate extends AggregateRoot<any, any>> = Record<
  string | symbol,
  CommandHandler<any, TAggregate>
>;

export interface AggregateRoot<
  TState,
  TInfrastructure extends Infrastructure = Infrastructure,
> {
  initialState: () => TState;
  eventHandlers?: EventHandlerMap<this>;
  commandHandlers?: CommandHandlerMap<this>;
}

export type ExtractAggregateState<TAggregate extends AggregateRoot<any, any>> =
  TAggregate extends AggregateRoot<infer TState, any> ? TState : never;

export type ExtractAggregateInfrastructure<
  TAggregate extends AggregateRoot<any, any>,
> =
  TAggregate extends AggregateRoot<any, infer TInfrastructure>
    ? TInfrastructure
    : never;
