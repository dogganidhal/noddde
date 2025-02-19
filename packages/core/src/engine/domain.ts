import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import { AggregateRoot, Projection } from "../ddd";
import { Command, CommandResult, StandaloneCommandHandler } from "../cqrs";
import { Event } from "../edd";
import { QueryHandler } from "../cqrs/query/query-handler";

type AggregateMap<TInfrastructure extends Infrastructure> = Record<
  string | symbol,
  AggregateRoot<any, any, TInfrastructure>
>;
type ProjectionMap<TInfrastructure extends Infrastructure> = Record<
  string | symbol,
  Projection<TInfrastructure>
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

type StandaloneCommandHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneCommandNames extends string | symbol = string | symbol,
> = {
  [CommandName in TStandaloneCommandNames]?: StandaloneCommandHandler<
    TInfrastructure,
    any
  >;
};
type StandaloneQueryHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneQueryNames extends string | symbol = string | symbol,
> = {
  [QueryName in TStandaloneQueryNames]?: QueryHandler<TInfrastructure, any>;
};

export type DomainConfiguration<
  TInfrastructure extends Infrastructure,
  TStandaloneCommandNames extends string | symbol = string | symbol,
  TStandaloneQueryNames extends string | symbol = string | symbol,
> = {
  writeModel: {
    aggregates: AggregateMap<TInfrastructure>;
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<
      TInfrastructure,
      TStandaloneCommandNames
    >;
  };
  readModel: {
    projections: ProjectionMap<TInfrastructure>;
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQueryNames
    >;
  };
  infrastructure: {
    aggregatePersistence?: CreatePersistenceConfiguration<TInfrastructure>;
    provideInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
    cqrsInfrastructure?: (
      infrastructure: TInfrastructure,
    ) => CQRSInfrastructure | Promise<CQRSInfrastructure>;
  };
};

export class Domain<TInfrastructure extends Infrastructure> {
  private _infrastructure!: TInfrastructure & CQRSInfrastructure;
  private _persistence!: PersistenceConfiguration;

  private get aggregateDefinitions() {
    return this.configuration.writeModel.aggregates;
  }

  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
    return this._infrastructure;
  }

  constructor(
    private readonly configuration: DomainConfiguration<TInfrastructure>,
  ) {}

  public async init(): Promise<void> {
    throw new Error("Not implemented");
  }

  public async dispatchCommand<TCommand extends Command>(
    command: TCommand,
  ): Promise<CommandResult<TCommand>> {
    throw new Error("Not implemented");
  }
}

export const configureDomain = async <
  TInfrastructure extends Infrastructure,
  TStandaloneCommandNames extends string | symbol = string | symbol,
>(
  configuration: DomainConfiguration<TInfrastructure, TStandaloneCommandNames>,
): Promise<Domain<TInfrastructure>> => {
  const domain = new Domain(configuration);
  await domain.init();
  return domain;
};
