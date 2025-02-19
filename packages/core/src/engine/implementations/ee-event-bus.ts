import { Event, EventBus } from "../../edd";
import EventEmitter from "node:events";

export class EventEmitterEventBus extends EventEmitter implements EventBus {
  constructor() {
    super();
  }

  public async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    this.emit(event.name, event.payload);
  }
}
