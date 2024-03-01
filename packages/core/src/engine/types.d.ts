import { Infrastructure } from "../infrastructure";
import { AggregateRoot } from "../ddd";
import { AggregateLoader } from "./aggregate-loader";
import { EventBus } from "../edd";
import { CommandBus } from "../cqrs";

type AggregateMap<TInfrastructure extends Infrastructure> = Record<
  string | symbol,
  AggregateRoot<any, TInfrastructure>
>;

type PerAggregatePersistenceConfig = Record<string | symbol, AggregateLoader>;
type PersistenceConfig = PerAggregatePersistenceConfig | AggregateLoader;

type CreatePersistenceConfig<TInfrastructure extends Infrastructure> = (
  infrastructure: TInfrastructure,
) => Promise<PersistenceConfig> | PersistenceConfig;

interface DomainConfig<TInfrastructure extends Infrastructure> {
  aggregates: AggregateMap<TInfrastructure>;
  persistence?: CreatePersistenceConfig<TInfrastructure>;
  createInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
  eventBus?: (infrastructure: TInfrastructure) => Promise<EventBus> | EventBus;
  commandBus?: (
    infrastructure: TInfrastructure,
  ) => Promise<CommandBus> | CommandBus;
}
