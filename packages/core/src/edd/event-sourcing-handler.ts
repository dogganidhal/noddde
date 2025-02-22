import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import { Event } from "./event";

export type EventSourcingHandler<
  TEvent extends Event,
  TState,
  TInfrastructure extends Infrastructure,
> = (
  event: TEvent["payload"],
  state: TState,
  infrastructure: TInfrastructure & CQRSInfrastructure,
) => TState;
