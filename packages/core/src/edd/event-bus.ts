import { Event } from "./event";

export interface EventBus {
  dispatch: <TEvent extends Event>(name: string, event: TEvent) => void;
}
