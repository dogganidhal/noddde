/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import { Event } from "../edd/event";
import { EvolveHandler } from "../edd/event-sourcing-handler";
import type { UpcasterMap } from "../edd/upcaster";
import { AggregateCommand } from "../cqrs/command/command";
import { Infrastructure, FrameworkInfrastructure } from "../infrastructure";

/**
 * A bundle of the four type parameters that define an aggregate's type universe.
 * Instead of threading 4+ positional generics through every type, users declare
 * a single named `AggregateTypes` that the framework destructures internally.
 *
 * @example
 * ```ts
 * type BankAccountTypes = {
 *   state: BankAccountState;
 *   events: BankAccountEvent;
 *   commands: BankAccountCommand;
 *   infrastructure: BankingInfrastructure;
 * };
 * ```
 */
export type AggregateTypes = {
  /** The aggregate's state shape. */
  state: any;
  /** The discriminated union of all events this aggregate can emit. */
  events: Event;
  /** The discriminated union of all commands this aggregate can handle. */
  commands: AggregateCommand<ID>;
  /** The external dependencies available to command handlers. */
  infrastructure: Infrastructure;
};

/**
 * A decide handler implements the "decide" phase of the Decider pattern.
 * It receives a command, the current aggregate state, and infrastructure,
 * then returns the event(s) representing what happened.
 *
 * The framework handles persistence and event dispatch — handlers only decide.
 *
 * @typeParam TCommand - The specific command type this handler processes.
 * @typeParam TState - The aggregate state type.
 * @typeParam TEvents - The union of all event types this aggregate can emit.
 * @typeParam TInfrastructure - The infrastructure dependencies available.
 *
 * @param command - The full command object (including `targetAggregateId`).
 * @param state - The current aggregate state (rebuilt from events or loaded from store).
 * @param infrastructure - External dependencies (clock, APIs, etc.).
 * @returns One or more events, optionally wrapped in a `Promise`.
 */
export type DecideHandler<
  TCommand extends AggregateCommand<ID>,
  TState,
  TEvents extends Event,
  TInfrastructure extends Infrastructure = Infrastructure,
> = (
  command: TCommand,
  state: TState,
  infrastructure: TInfrastructure & FrameworkInfrastructure,
) => TEvents | TEvents[] | Promise<TEvents | TEvents[]>;

// ---- Handler maps (internal) ----

type DecideHandlerMap<T extends AggregateTypes> = {
  [K in T["commands"]["name"]]: DecideHandler<
    Extract<T["commands"], { name: K }>,
    T["state"],
    T["events"],
    T["infrastructure"]
  >;
};

type EvolveHandlerMap<T extends AggregateTypes> = {
  [K in T["events"]["name"]]: EvolveHandler<
    Extract<T["events"], { name: K }>,
    T["state"]
  >;
};

/**
 * An aggregate definition following the Decider pattern: initial state,
 * decide handlers, and evolve handlers. No base classes,
 * no decorators — just a typed object.
 *
 * Use {@link defineAggregate} to create an aggregate with full type inference.
 *
 * @typeParam T - The {@link AggregateTypes} bundle for this aggregate.
 */
export interface Aggregate<T extends AggregateTypes = AggregateTypes> {
  /** The zero-value state used when no events have been applied yet. */
  initialState: T["state"];
  /**
   * A map of decide handlers keyed by command name. Each handler implements
   * the "decide" phase: `(command, state, infrastructure) => event(s)`.
   */
  decide: DecideHandlerMap<T>;
  /**
   * A map of evolve handlers keyed by event name. Each handler implements
   * the "evolve" phase: `(payload, state) => newState`. Must be pure.
   */
  evolve: EvolveHandlerMap<T>;
  /**
   * Optional map of upcaster chains keyed by event name. Each chain
   * transforms historical event payloads from older schema versions
   * to the current version during event replay. Only events that have
   * undergone schema changes need entries.
   *
   * @see {@link UpcasterMap}
   */
  upcasters?: UpcasterMap<T["events"]>;
}

/**
 * Identity function that creates an aggregate definition with full type inference
 * across the command/event/state/infrastructure boundaries. This is the
 * recommended way to define aggregates.
 *
 * @typeParam T - Inferred {@link AggregateTypes} bundle.
 * @param config - The aggregate configuration (initialState, decide, evolve).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const BankAccount = defineAggregate<BankAccountTypes>({
 *   initialState: { balance: 0, transactions: [] },
 *   decide: {
 *     CreateAccount: (command, state) => ({ name: "AccountCreated", payload: { id: command.targetAggregateId } }),
 *     // ...
 *   },
 *   evolve: {
 *     AccountCreated: (payload, state) => ({ ...state, id: payload.id }),
 *     // ...
 *   },
 * });
 * ```
 */
export function defineAggregate<T extends AggregateTypes>(
  config: Aggregate<T>,
): Aggregate<T> {
  return config;
}

// ---- Type inference helpers ----

/**
 * Extracts the aggregate ID type from an {@link AggregateTypes} bundle.
 *
 * @typeParam T - The {@link AggregateTypes} bundle (not the `Aggregate` definition).
 */
export type InferAggregateID<T extends AggregateTypes> =
  T["commands"]["targetAggregateId"];

/**
 * Extracts the state type from an {@link Aggregate} definition.
 *
 * @example
 * ```ts
 * type State = InferAggregateState<typeof BankAccount>; // BankAccountState
 * ```
 */
export type InferAggregateState<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["state"] : never;

/**
 * Extracts the event union type from an {@link Aggregate} definition.
 *
 * @example
 * ```ts
 * type Events = InferAggregateEvents<typeof BankAccount>; // BankAccountEvent
 * ```
 */
export type InferAggregateEvents<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["events"] : never;

/**
 * Extracts the command union type from an {@link Aggregate} definition.
 *
 * @example
 * ```ts
 * type Commands = InferAggregateCommands<typeof BankAccount>; // BankAccountCommand
 * ```
 */
export type InferAggregateCommands<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["commands"] : never;

/**
 * Extracts the union of all command types from a map of aggregates.
 * Distributes {@link InferAggregateCommands} across each value in the map.
 *
 * @example
 * ```ts
 * const aggregates = { Counter, Todo } as const;
 * type AllCommands = InferAggregateMapCommands<typeof aggregates>;
 * // CounterCommand | TodoCommand
 * ```
 */
export type InferAggregateMapCommands<
  TMap extends Record<string | symbol, Aggregate<any>>,
> = {
  [K in keyof TMap]: TMap[K] extends Aggregate<infer U> ? U["commands"] : never;
}[keyof TMap];

/**
 * Extracts the infrastructure type from an {@link Aggregate} definition.
 *
 * @example
 * ```ts
 * type Infra = InferAggregateInfrastructure<typeof BankAccount>; // BankingInfrastructure
 * ```
 */
export type InferAggregateInfrastructure<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["infrastructure"] : never;

/**
 * Computes the intersection of all infrastructure types declared across
 * a map of aggregates. Used by `wireDomain` to infer what the
 * `wiring.infrastructure` factory must return.
 *
 * @example
 * ```ts
 * // Auction needs { clock: Clock }, Booking needs { clock: Clock, email: EmailService }
 * type Infra = InferAggregateMapInfrastructure<typeof aggregates>;
 * // { clock: Clock } & { clock: Clock, email: EmailService }
 * ```
 */
export type InferAggregateMapInfrastructure<
  TMap extends Record<string | symbol, Aggregate<any>>,
> = {
  [K in keyof TMap]: TMap[K] extends Aggregate<infer U>
    ? U["infrastructure"]
    : never;
}[keyof TMap];

// ---- Handler-level inference utilities ----

/**
 * Infers the fully-typed decide handler function for a specific command name
 * within an {@link AggregateTypes} bundle. Use this to type extracted handlers
 * in separate files without manually reconstructing the function signature.
 *
 * Operates on the `AggregateTypes` bundle (not the `Aggregate` definition),
 * so it can be used before `defineAggregate` is called.
 *
 * @typeParam T - The {@link AggregateTypes} bundle.
 * @typeParam K - The command name literal (a member of `T["commands"]["name"]`).
 *
 * @example
 * ```ts
 * // decide-confirm-booking.ts
 * export const decideConfirmBooking: InferDecideHandler<BookingDef, "ConfirmBooking"> = (
 *   command, state, { clock }
 * ) => ({ name: "BookingConfirmed", payload: { confirmedAt: clock.now() } });
 * ```
 */
export type InferDecideHandler<
  T extends AggregateTypes,
  K extends T["commands"]["name"],
> = DecideHandler<
  Extract<T["commands"], { name: K }>,
  T["state"],
  T["events"],
  T["infrastructure"]
>;

/**
 * Infers the fully-typed evolve handler function for a specific event name
 * within an {@link AggregateTypes} bundle. Use this to type extracted evolve
 * handlers (event reducers) in separate files.
 *
 * Operates on the `AggregateTypes` bundle (not the `Aggregate` definition),
 * so it can be used before `defineAggregate` is called.
 *
 * @typeParam T - The {@link AggregateTypes} bundle.
 * @typeParam K - The event name literal (a member of `T["events"]["name"]`).
 *
 * @example
 * ```ts
 * // evolve-booking-confirmed.ts
 * export const evolveBookingConfirmed: InferEvolveHandler<BookingDef, "BookingConfirmed"> = (
 *   payload, state
 * ) => ({ ...state, status: "confirmed", confirmedAt: payload.confirmedAt });
 * ```
 */
export type InferEvolveHandler<
  T extends AggregateTypes,
  K extends T["events"]["name"],
> = EvolveHandler<Extract<T["events"], { name: K }>, T["state"]>;
