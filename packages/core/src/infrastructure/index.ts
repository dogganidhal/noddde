import { CommandBus } from "../cqrs";
import { EventBus } from "../edd";
import { AggregateRoot, ExtractAggregateState } from "../ddd";

export type Infrastructure = {};

export interface VInfrastructure {
  commandBus: CommandBus;
  eventBus: EventBus;
}

export interface AggregateRepository<TAggregate extends AggregateRoot<any>> {
  save: (id: string, state: ExtractAggregateState<TAggregate>) => Promise<void>;
  load: (id: string) => Promise<ExtractAggregateState<TAggregate>>;
}
