import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import { EventEmitterEventBus } from "./implementations/ee-event-bus";
import { InMemoryCommandBus } from "./implementations/in-memory-command-bus";
import {
  DomainConfig,
  PerAggregatePersistenceConfig,
  PersistenceConfig,
} from "./types";
import { InMemoryAggregatePersistence } from "./implementations/in-memory-aggregate-persistence";
import { AggregateLoader } from "./aggregate-loader";

export class Domain<TInfrastructure extends Infrastructure> {
  private _infrastructure!: TInfrastructure & CQRSInfrastructure;
  private _persistence!: PersistenceConfig;

  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
    return this._infrastructure;
  }

  public get aggregateDefinitions() {
    return this.config.aggregates;
  }

  constructor(private readonly config: DomainConfig<TInfrastructure>) {}

  public async init(): Promise<void> {
    const providedInfrastructure = this.config.createInfrastructure
      ? await this.config.createInfrastructure()
      : ({} as TInfrastructure);
    this._infrastructure = {
      eventBus: this.config.eventBus
        ? await this.config.eventBus(providedInfrastructure)
        : new EventEmitterEventBus(this),
      commandBus: this.config.commandBus
        ? await this.config.commandBus(providedInfrastructure)
        : new InMemoryCommandBus(this),
      ...providedInfrastructure,
    };
    this.config.persistence
      ? (this._persistence = await this.config.persistence(
          this._infrastructure,
        ))
      : new InMemoryAggregatePersistence();
  }

  public async loadAggregate<TState = {}>(
    aggregateName: string,
    id: string,
  ): Promise<TState | null> {
    let loader: AggregateLoader;

    if (typeof this._persistence === "object") {
      const aggregateSpecificLoader = (
        this._persistence as PerAggregatePersistenceConfig
      )[aggregateName];

      if (!aggregateSpecificLoader) {
        throw new Error(
          `No persistence loader found for aggregate ${aggregateName}`,
        );
      }

      loader = aggregateSpecificLoader;
    } else {
      loader = this._persistence as AggregateLoader;
    }

    return loader.load(aggregateName, id);
  }
}

declare global {
  var domain: Domain<any>;
}

export const initDomain = async <TInfrastructure extends Infrastructure>(
  config: DomainConfig<TInfrastructure>,
) => {
  global.domain = new Domain(config);
};
