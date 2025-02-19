import { Infrastructure } from "../infrastructure";
import { EventHandler } from "../edd";
import { QueryHandler } from "../cqrs/query/query-handler";

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
