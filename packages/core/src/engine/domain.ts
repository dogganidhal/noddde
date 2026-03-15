import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import { Aggregate, Projection } from "../ddd";
import { StandaloneCommandHandler } from "../cqrs";
import { AggregateCommand } from "../cqrs/command/command";
import { Event } from "../edd";
import { QueryHandler } from "../cqrs/query/query-handler";

type AggregateMap = Record<string | symbol, Aggregate<any>>;

type ProjectionMap<TInfrastructure extends Infrastructure> = Record<
  string | symbol,
  Projection<TInfrastructure>
>;

export interface StateStoredAggregatePersistence {
  save(aggregateName: string, aggregateId: string, state: any): Promise<void>;
  load(aggregateName: string, aggregateId: string): Promise<any>;
}

export interface EventSourcedAggregatePersistence {
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void>;
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
}

type PersistenceConfiguration =
  | StateStoredAggregatePersistence
  | EventSourcedAggregatePersistence;

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
    aggregates: AggregateMap;
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
    aggregatePersistence?: () =>
      | PersistenceConfiguration
      | Promise<PersistenceConfiguration>;
    provideInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
    cqrsInfrastructure?: (
      infrastructure: TInfrastructure,
    ) => CQRSInfrastructure | Promise<CQRSInfrastructure>;
  };
};

export class Domain<TInfrastructure extends Infrastructure> {
  private _infrastructure!: TInfrastructure & CQRSInfrastructure;
  private _persistence!: PersistenceConfiguration;

  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
    return this._infrastructure;
  }

  constructor(
    private readonly configuration: DomainConfiguration<TInfrastructure>,
  ) {}

  public async init(): Promise<void> {
    throw new Error("Not implemented");
  }

  public async dispatchCommand<TCommand extends AggregateCommand<any>>(
    command: TCommand,
  ): Promise<TCommand["targetAggregateId"]> {
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
