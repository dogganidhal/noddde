import { Infrastructure, VInfrastructure } from "../infrastructure";
import { AggregateRoot } from "../ddd";
import { EventBus } from "../edd";
import { CommandBus } from "../cqrs";
import { EventEmitterEventBus } from "./implementations/ee-event-bus";
import { InMemoryCommandBus } from "./implementations/in-memory-command-bus";

type AggregateMap<TInfrastructure extends Infrastructure> = Record<
  string | symbol,
  AggregateRoot<any, TInfrastructure>
>;

interface VConfig<TInfrastructure extends Infrastructure> {
  aggregates: AggregateMap<TInfrastructure>;
  createInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
  eventBus?: () => EventBus;
  commandBus?: () => CommandBus;
}

export class VEngine<TInfrastructure extends Infrastructure = Infrastructure> {
  public readonly infrastructure: VInfrastructure & TInfrastructure;

  private constructor(
    public readonly aggregates: AggregateMap<TInfrastructure>,
    userProvidedInfrastructure: TInfrastructure,
    config: VConfig<TInfrastructure>,
  ) {
    this.infrastructure = {
      eventBus: config.eventBus
        ? config.eventBus()
        : new EventEmitterEventBus(this),
      commandBus: config.commandBus
        ? config.commandBus()
        : new InMemoryCommandBus(this),
      ...userProvidedInfrastructure,
    };
  }

  public static async create<TInfrastructure extends Infrastructure>(
    config: VConfig<TInfrastructure>,
  ) {
    const userProvidedInfrastructure = config.createInfrastructure
      ? await config.createInfrastructure()
      : {};
    return new VEngine(config.aggregates, userProvidedInfrastructure, config);
  }
}

declare global {
  var v: VEngine<any>;
}

export const initV = async <TInfrastructure extends Infrastructure>(
  config: VConfig<TInfrastructure>,
) => {
  global.v = await VEngine.create(config);
};
