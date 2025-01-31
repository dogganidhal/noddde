import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import { EventEmitterEventBus } from "./implementations/ee-event-bus";
import { InMemoryCommandBus } from "./implementations/in-memory-command-bus";
import { InMemoryAggregatePersistence } from "./implementations/in-memory-aggregate-persistence";
import { AggregateRoot, InferAggregateID, InferAggregateState } from "../ddd";
import { CommandBus, ExternalCommandHandler } from "../cqrs";
import { Event, EventBus } from "../edd";

type AggregateMap<TInfrastructure extends Infrastructure> = Record<
  string | symbol,
  AggregateRoot<any, any, TInfrastructure>
>;

export interface StateStoredAggregatePersistence {
  save(aggregateName: string, aggregateId: any, state: any): Promise<void>;
  load(aggregateName: string, aggregateId: any): Promise<any>;
}
export interface EventSourcedAggregatePersistence {
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void>;
  load(aggregateName: string, aggregateId: any): Promise<Event[]>;
}

type PersistenceConfiguration =
  | StateStoredAggregatePersistence
  | EventSourcedAggregatePersistence;

type CreatePersistenceConfiguration<TInfrastructure extends Infrastructure> = (
  infrastructure: TInfrastructure,
) => Promise<PersistenceConfiguration> | PersistenceConfiguration;

type ExternalCommandHandlerMap<
  TInfrastructure extends Infrastructure,
  TExternalCommandNames extends string | symbol = string | symbol,
> = {
  [CommandName in TExternalCommandNames]?: ExternalCommandHandler<
    TInfrastructure,
    any
  >;
};

export type DomainConfiguration<
  TInfrastructure extends Infrastructure,
  TExternalCommandNames extends string | symbol = string | symbol,
> = {
  aggregates: AggregateMap<TInfrastructure>;
  externalCommandHandlers?: ExternalCommandHandlerMap<
    TInfrastructure,
    TExternalCommandNames
  >;
  persistence?: CreatePersistenceConfiguration<TInfrastructure>;
  createInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
  eventBus?: (infrastructure: TInfrastructure) => Promise<EventBus> | EventBus;
  commandBus?: (
    infrastructure: TInfrastructure,
  ) => Promise<CommandBus> | CommandBus;
};

export class Domain<TInfrastructure extends Infrastructure> {
  private _infrastructure!: TInfrastructure & CQRSInfrastructure;
  private _persistence!: PersistenceConfiguration;

  private get aggregateDefinitions() {
    return this.configuration.aggregates;
  }

  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
    return this._infrastructure;
  }

  public get commandBus(): CommandBus {
    return this._infrastructure.commandBus;
  }

  public get eventBus(): EventBus {
    return this._infrastructure.eventBus;
  }

  constructor(
    private readonly configuration: DomainConfiguration<TInfrastructure>,
  ) {}

  public async init(): Promise<void> {
    const providedInfrastructure =
      (this.configuration.createInfrastructure?.() ?? {}) as TInfrastructure;
    this._infrastructure = {
      eventBus: this.configuration.eventBus
        ? await this.configuration.eventBus(providedInfrastructure)
        : new EventEmitterEventBus(this),
      commandBus: this.configuration.commandBus
        ? await this.configuration.commandBus(providedInfrastructure)
        : new InMemoryCommandBus(this),
      ...providedInfrastructure,
    };
    this.configuration.persistence
      ? (this._persistence = await this.configuration.persistence(
          this._infrastructure,
        ))
      : new InMemoryAggregatePersistence();
  }

  public async loadAggregate<TAggregate extends AggregateRoot>(
    aggregateName: string,
    id: InferAggregateID<TAggregate>,
  ): Promise<InferAggregateState<TAggregate> | null> {
    throw new Error("Not implemented");
  }
}

export const configureDomain = async <
  TInfrastructure extends Infrastructure,
  TExternalCommandNames extends string | symbol = string | symbol,
>(
  configuration: DomainConfiguration<TInfrastructure, TExternalCommandNames>,
): Promise<Domain<TInfrastructure>> => {
  const domain = new Domain(configuration);
  await domain.init();
  return domain;
};
