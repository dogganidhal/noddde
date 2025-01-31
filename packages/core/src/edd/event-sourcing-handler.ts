import { Event } from "./event";
import { CQRSInfrastructure } from "../infrastructure";
import {
  AggregateRoot,
  InferAggregateInfrastructure,
  InferAggregateState,
} from "../ddd";

export type EventSourcingHandler<
  TEvent extends Event,
  TAggregate extends AggregateRoot,
> = (
  event: TEvent["payload"],
  state: InferAggregateState<TAggregate>,
  infrastructure: InferAggregateInfrastructure<TAggregate> & CQRSInfrastructure,
) => InferAggregateState<TAggregate> | Promise<InferAggregateState<TAggregate>>;
