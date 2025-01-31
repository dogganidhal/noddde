import { Event } from "./event";

export interface EventBus {
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
}
