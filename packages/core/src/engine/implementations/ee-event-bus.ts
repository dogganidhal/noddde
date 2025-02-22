import { Event, EventBus } from "../../edd";
import { EventEmitter } from "node:events";

export class EventEmitterEventBus implements EventBus {
  private readonly underlying = new EventEmitter();

  public async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    this.underlying.emit(event.name, event.payload);
  }
}
