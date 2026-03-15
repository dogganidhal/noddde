import { Event } from "./event";

export type ApplyHandler<TEvent extends Event, TState> = (
  event: TEvent["payload"],
  state: TState,
) => TState;
