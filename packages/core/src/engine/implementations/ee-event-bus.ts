import { Event, EventBus } from "../../edd";
import EventEmitter from "node:events";
import { Domain } from "../index";

export class EventEmitterEventBus extends EventEmitter implements EventBus {
  constructor(private readonly domain: Domain<any>) {
    super();
  }

  public async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    this.emit(event.name, event.payload);
  }
}
