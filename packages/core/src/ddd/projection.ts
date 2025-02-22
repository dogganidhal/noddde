import { Infrastructure } from "../infrastructure";
import { EventHandler, Event } from "../edd";
import { QueryHandler } from "../cqrs";

type EventHandlerMap<
  TInfrastructure extends Infrastructure,
  TEventNames extends string | symbol = string | symbol,
> = {
  [EventName in TEventNames]?: EventHandler<any, TInfrastructure>;
};

type QueryHandlerMap<
  TInfrastructure extends Infrastructure,
  TQueryNames extends string | symbol = string | symbol,
> = {
  [QueryName in TQueryNames]?: QueryHandler<TInfrastructure, any>;
};

export type Projection<
  TInfrastructure extends Infrastructure,
  TEventNames extends string | symbol = string | symbol,
  TQueryNames extends string | symbol = string | symbol,
> = {
  eventHandlers: EventHandlerMap<TInfrastructure, TEventNames>;
  queryHandlers: QueryHandlerMap<TInfrastructure, TQueryNames>;
};

export type ProjectionV2<TEvent extends Event, TView = any> = {
  reducer: (view: TView, event: TEvent) => TView;
};
