import { Event } from "./event";
import { Infrastructure } from "../infrastructure";

export type EventHandler<
  TEvent extends Event,
  TInfrastructure extends Infrastructure,
> = (
  event: TEvent["payload"],
  infrastructure: TInfrastructure,
) => void | Promise<void>;
