export interface AggregateLoader {
  load<TState>(aggregateName: string, id: string): Promise<TState | null>;
  save<TState>(aggregateName: string, id: string, state: TState): Promise<void>;
}
