import { Event } from "./event";
import { VInfrastructure } from "../infrastructure";
import {
  AggregateRoot,
  ExtractAggregateInfrastructure,
  ExtractAggregateState,
} from "../ddd";

export type EventHandler<
  TEvent extends Event,
  TAggregate extends AggregateRoot<any, any>,
> = (
  event: TEvent,
  state: ExtractAggregateState<TAggregate>,
  infrastructure: ExtractAggregateInfrastructure<TAggregate> & VInfrastructure,
) =>
  | ExtractAggregateState<TAggregate>
  | Promise<ExtractAggregateState<TAggregate>>;
