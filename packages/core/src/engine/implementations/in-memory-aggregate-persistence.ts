import { Event } from "../../edd";
import { EventSourcedAggregatePersistence } from "../domain";

export class InMemoryAggregatePersistence
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
