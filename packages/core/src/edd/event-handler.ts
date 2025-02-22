import { Event } from "./event";
import { CQRSInfrastructure, Infrastructure } from "../infrastructure";

export type StatefulEventHandler<
  TEvent extends Event,
  TState,
  TInfrastructure extends Infrastructure,
> = (
  event: TEvent["payload"],
  state: TState,
  infrastructure: TInfrastructure & CQRSInfrastructure,
) => void | Promise<void>;

export type EventHandler<
  TEvent extends Event,
  TInfrastructure extends Infrastructure,
> = (
  event: TEvent["payload"],
  infrastructure: TInfrastructure,
) => void | Promise<void>;
