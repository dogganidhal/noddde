import { AggregateLoader } from "../aggregate-loader";

export class InMemoryAggregatePersistence implements AggregateLoader {
  private readonly stateMap: Map<string, Map<string, any>> = new Map();

  public async load<TState>(
    aggregateName: string,
    id: string,
  ): Promise<TState | null> {
    const aggregateMap = this.stateMap.get(aggregateName);
    if (!aggregateMap) {
      return null;
    }
    return aggregateMap.get(id);
  }
  public async save<TState>(
    aggregateName: string,
    id: string,
    state: TState,
  ): Promise<void> {
    let aggregateMap = this.stateMap.get(aggregateName);
    if (!aggregateMap) {
      aggregateMap = new Map();
      this.stateMap.set(aggregateName, aggregateMap);
    }
    aggregateMap.set(id, state);
  }
}
