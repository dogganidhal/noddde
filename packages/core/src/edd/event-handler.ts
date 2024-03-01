import { Event } from "./event";
import { CQRSInfrastructure } from "../infrastructure";
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
  infrastructure: ExtractAggregateInfrastructure<TAggregate> &
    CQRSInfrastructure,
) =>
  | ExtractAggregateState<TAggregate>
  | Promise<ExtractAggregateState<TAggregate>>;
