import { Event, EventBus } from "../../edd";
import EventEmitter from "node:events";
import { Domain } from "../index";

export class EventEmitterEventBus extends EventEmitter implements EventBus {
  constructor(private readonly engine: Domain<any>) {
    super();
  }

  public dispatch<TEvent extends Event>(name: string, event: TEvent): void {
    this.emit(name, event);
  }
}
