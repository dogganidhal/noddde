import { Event } from "../edd/event";
import { ApplyHandler } from "../edd/event-sourcing-handler";
import { AggregateCommand } from "../cqrs/command/command";
import { Infrastructure } from "../infrastructure";

// ---- Types bundle ----
// Instead of 5 positional generic parameters, users declare a single
// named type that bundles their aggregate's type universe.

export type AggregateTypes = {
  state: any;
  events: Event;
  commands: AggregateCommand;
  infrastructure: Infrastructure;
};

// ---- Command handler ----
// Command handlers are pure decision-makers: they receive the command,
// the current state, and infrastructure, then return the event(s) that
// represent what happened. The framework handles persistence and dispatch.

export type CommandHandler<
  TCommand extends AggregateCommand,
  TState,
  TEvents extends Event,
  TInfrastructure extends Infrastructure = Infrastructure,
> = (
  command: TCommand,
  state: TState,
  infrastructure: TInfrastructure,
) => TEvents | TEvents[] | Promise<TEvents | TEvents[]>;

// ---- Handler maps ----

type CommandHandlerMap<T extends AggregateTypes> = {
  [K in T["commands"]["name"]]: CommandHandler<
    Extract<T["commands"], { name: K }>,
    T["state"],
    T["events"],
    T["infrastructure"]
  >;
};

type ApplyHandlerMap<T extends AggregateTypes> = {
  [K in T["events"]["name"]]: ApplyHandler<
    Extract<T["events"], { name: K }>,
    T["state"]
  >;
};

// ---- Aggregate definition ----
// An aggregate is a Decider: initialState + command handlers + apply handlers.
// No base classes, no decorators — just a typed object.

export interface Aggregate<T extends AggregateTypes = AggregateTypes> {
  initialState: T["state"];
  commands: CommandHandlerMap<T>;
  apply: ApplyHandlerMap<T>;
}

// Factory function that provides full type inference across
// the command/event/state/infrastructure boundaries.
export function defineAggregate<T extends AggregateTypes>(
  config: Aggregate<T>,
): Aggregate<T> {
  return config;
}

// ---- Type inference helpers ----

export type InferAggregateID<T extends AggregateTypes> =
  T["commands"]["targetAggregateId"];

export type InferAggregateState<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["state"] : never;

export type InferAggregateEvents<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["events"] : never;

export type InferAggregateCommands<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["commands"] : never;

export type InferAggregateInfrastructure<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["infrastructure"] : never;
