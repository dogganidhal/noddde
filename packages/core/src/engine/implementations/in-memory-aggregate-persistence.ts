import { Event } from "../../edd";
import {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
} from "../domain";

export class InMemoryEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
{
  public async load(aggregateName: string, aggregateId: any): Promise<Event[]> {
    throw new Error("Not implemented");
  }
  public async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void> {
    throw new Error("Not implemented");
  }
}

export class InMemoryStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  public async load(aggregateName: string, aggregateId: any): Promise<any> {
    throw new Error("Not implemented");
  }
  public async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
  ): Promise<void> {
    throw new Error("Not implemented");
  }
}
