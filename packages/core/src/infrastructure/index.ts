import { CommandBus, QueryBus } from "../cqrs";
import { EventBus } from "../edd";
import { AggregateRoot, InferAggregateState } from "../ddd";

export type Infrastructure = {};

export interface CQRSInfrastructure {
  commandBus: CommandBus;
  eventBus: EventBus;
  queryBus: QueryBus;
}

export interface AggregateRepository<TAggregate extends AggregateRoot<any>> {
  save: (id: string, state: InferAggregateState<TAggregate>) => Promise<void>;
  load: (id: string) => Promise<InferAggregateState<TAggregate>>;
}
