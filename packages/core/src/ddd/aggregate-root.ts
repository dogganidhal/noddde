/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import { Event } from "../edd/event";
import { ApplyHandler } from "../edd/event-sourcing-handler";
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
 * A command handler implements the "decide" phase of the Decider pattern.
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
export type CommandHandler<
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

/**
 * An aggregate definition following the Decider pattern: initial state,
 * command handlers (decide), and apply handlers (evolve). No base classes,
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
   * A map of command handlers keyed by command name. Each handler implements
   * the "decide" phase: `(command, state, infrastructure) => event(s)`.
   */
  commands: CommandHandlerMap<T>;
  /**
   * A map of apply handlers keyed by event name. Each handler implements
   * the "evolve" phase: `(payload, state) => newState`. Must be pure.
   */
  apply: ApplyHandlerMap<T>;
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
 * @param config - The aggregate configuration (initialState, commands, apply).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const BankAccount = defineAggregate<BankAccountTypes>({
 *   initialState: { balance: 0, transactions: [] },
 *   commands: {
 *     CreateAccount: (command, state) => ({ name: "AccountCreated", payload: { id: command.targetAggregateId } }),
 *     // ...
 *   },
 *   apply: {
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
 * Extracts the infrastructure type from an {@link Aggregate} definition.
 *
 * @example
 * ```ts
 * type Infra = InferAggregateInfrastructure<typeof BankAccount>; // BankingInfrastructure
 * ```
 */
export type InferAggregateInfrastructure<T extends Aggregate> =
  T extends Aggregate<infer U> ? U["infrastructure"] : never;

// ---- Handler-level inference utilities ----

/**
 * Infers the fully-typed command handler function for a specific command name
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
 * // handle-confirm-booking.ts
 * export const handleConfirmBooking: InferCommandHandler<BookingDef, "ConfirmBooking"> = (
 *   command, state, { clock }
 * ) => ({ name: "BookingConfirmed", payload: { confirmedAt: clock.now() } });
 * ```
 */
export type InferCommandHandler<
  T extends AggregateTypes,
  K extends T["commands"]["name"],
> = CommandHandler<
  Extract<T["commands"], { name: K }>,
  T["state"],
  T["events"],
  T["infrastructure"]
>;

/**
 * Infers the fully-typed apply handler function for a specific event name
 * within an {@link AggregateTypes} bundle. Use this to type extracted apply
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
 * // apply-booking-confirmed.ts
 * export const applyBookingConfirmed: InferApplyHandler<BookingDef, "BookingConfirmed"> = (
 *   payload, state
 * ) => ({ ...state, status: "confirmed", confirmedAt: payload.confirmedAt });
 * ```
 */
export type InferApplyHandler<
  T extends AggregateTypes,
  K extends T["events"]["name"],
> = ApplyHandler<Extract<T["events"], { name: K }>, T["state"]>;
