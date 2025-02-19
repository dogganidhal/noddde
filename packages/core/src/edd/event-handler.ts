import { Event } from "./event";
import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import {
  AggregateRoot,
  InferAggregateInfrastructure,
  InferAggregateState,
} from "../ddd";

export type StatefulEventHandler<
  TEvent extends Event,
  TAggregate extends AggregateRoot,
> = (
  event: TEvent["payload"],
  state: InferAggregateState<TAggregate>,
  infrastructure: InferAggregateInfrastructure<TAggregate> & CQRSInfrastructure,
) => void | Promise<void>;

export type EventHandler<
  TEvent extends Event,
  TInfrastructure extends Infrastructure,
> = (
  event: TEvent["payload"],
  infrastructure: TInfrastructure,
) => void | Promise<void>;
