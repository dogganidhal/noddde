/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import { Event } from "../edd/event";
import { Command } from "../cqrs/command/command";
import {
  Infrastructure,
  CQRSInfrastructure,
  FrameworkInfrastructure,
} from "../infrastructure";

// ---- Types bundle ----

/**
 * A bundle of the four type parameters that define a saga's type universe.
 * Instead of threading 4+ positional generics through every type, users declare
 * a single named `SagaTypes` that the framework destructures internally.
 *
 * Mirrors the {@link AggregateTypes} pattern for aggregates and
 * {@link ProjectionTypes} for projections.
 *
 * A saga is the structural inverse of an aggregate:
 * - **Aggregate**: command in → events out
 * - **Saga**: event in → commands out
 *
 * @example
 * ```ts
 * type OrderFulfillmentSagaDef = {
 *   state: OrderFulfillmentState;
 *   events: OrderEvent | PaymentEvent | ShippingEvent;
 *   commands: PaymentCommand | ShippingCommand | OrderCommand;
 *   infrastructure: FulfillmentInfrastructure;
 * };
 * ```
 */
export type SagaTypes = {
  /** The saga's internal state tracking workflow progress. */
  state: any;
  /** The discriminated union of all events this saga reacts to. */
  events: Event;
  /** The discriminated union of all commands this saga may dispatch. */
  commands: Command;
  /** The external dependencies available to event handlers. */
  infrastructure: Infrastructure;
};

// ---- Reaction return type ----

/**
 * The return type of a saga event handler. Contains the new saga state
 * and zero or more commands to dispatch. This mirrors how aggregate command
 * handlers return events — saga event handlers return commands.
 *
 * @typeParam TState - The saga state type.
 * @typeParam TCommands - The union of command types this saga may dispatch.
 */
export type SagaReaction<TState, TCommands extends Command> = {
  /** The updated saga state after processing this event. */
  state: TState;
  /**
   * Commands to dispatch as a result of this event. Omit or set to
   * `undefined` when the handler only updates state without dispatching.
   */
  commands?: TCommands | TCommands[];
};

// ---- Event handler ----

/**
 * A saga event handler implements the "react" phase of the process manager
 * pattern. It receives a domain event, the current saga state, and
 * infrastructure, then returns the new state plus commands to dispatch.
 *
 * This is the inverse of an aggregate's {@link CommandHandler}: where a
 * command handler receives a command and returns events, a saga event
 * handler receives an event and returns commands.
 *
 * @typeParam TEvent - The specific event type this handler processes.
 * @typeParam TState - The saga state type.
 * @typeParam TCommands - The union of command types this saga may dispatch.
 * @typeParam TInfrastructure - The infrastructure dependencies available.
 *
 * @param event - The full event object (with type narrowed by event name).
 * @param state - The current saga state (loaded from persistence, or
 *   `initialState` if this event starts the saga).
 * @param infrastructure - External dependencies merged with CQRS buses.
 * @returns The reaction: new state + commands to dispatch.
 */
export type SagaEventHandler<
  TEvent extends Event,
  TState,
  TCommands extends Command,
  TInfrastructure extends Infrastructure = Infrastructure,
> = (
  event: TEvent,
  state: TState,
  infrastructure: TInfrastructure &
    CQRSInfrastructure &
    FrameworkInfrastructure,
) => SagaReaction<TState, TCommands> | Promise<SagaReaction<TState, TCommands>>;

// ---- On-map entry ----

/**
 * A single entry in the saga's `on` map. Bundles the identity extractor
 * (routing) and the event handler (behavior) for one event type.
 *
 * This is the saga equivalent of {@link ProjectionEventHandler} for
 * projections: each `on` entry bundles an `id` function and a `handle`
 * function, just as projection entries bundle `id` and `reduce`.
 *
 * @typeParam TEvent - The narrowed event type for this entry.
 * @typeParam TState - The saga state type.
 * @typeParam TCommands - The union of command types this saga may dispatch.
 * @typeParam TInfrastructure - The infrastructure dependencies available.
 * @typeParam TSagaId - The saga instance identifier type.
 */
export type SagaOnEntry<
  TEvent extends Event,
  TState,
  TCommands extends Command,
  TInfrastructure extends Infrastructure = Infrastructure,
  TSagaId extends ID = string,
> = {
  /** Extracts the saga instance ID from the event. Required for routing. */
  id: (event: TEvent) => TSagaId;
  /** The saga event handler: receives event, state, and infrastructure. */
  handle: SagaEventHandler<TEvent, TState, TCommands, TInfrastructure>;
};

// ---- On map ----

/**
 * Maps event names to their saga on-entries. Each entry bundles an
 * identity extractor (`id`) and a handler (`handle`). This map is
 * **partial** — only events the saga handles need entries. Unhandled
 * events are silently ignored at runtime.
 *
 * @typeParam T - The {@link SagaTypes} bundle.
 * @typeParam TSagaId - The saga instance identifier type.
 */
type SagaOnMap<T extends SagaTypes, TSagaId extends ID = string> = {
  [K in T["events"]["name"]]?: SagaOnEntry<
    Extract<T["events"], { name: K }>,
    T["state"],
    T["commands"],
    T["infrastructure"],
    TSagaId
  >;
};

// ---- Saga definition ----

/**
 * A saga definition following the process manager pattern: initial state,
 * lifecycle declaration (startedBy), and a unified `on` map that bundles
 * identity extraction and event handling per event type. No base classes,
 * no decorators — just a typed object.
 *
 * The `on` map is partial — only events the saga handles need entries.
 * Each entry bundles an `id` function (extracts saga instance ID) and a
 * `handle` function (processes the event and returns a reaction).
 *
 * Use {@link defineSaga} to create a saga with full type inference.
 *
 * @typeParam T - The {@link SagaTypes} bundle for this saga.
 * @typeParam TSagaId - The saga instance identifier type. Bounded by {@link ID}, defaults to `string`.
 */
export interface Saga<
  T extends SagaTypes = SagaTypes,
  TSagaId extends ID = string,
> {
  /**
   * The zero-value state used when a saga instance is first created
   * (when a `startedBy` event arrives with no existing saga instance).
   */
  initialState: T["state"];

  /**
   * One or more event names that start a new saga instance. When one of
   * these events arrives and no saga instance exists for the derived ID,
   * a new instance is created with `initialState`.
   *
   * Must be a non-empty subset of the saga's event names.
   */
  startedBy: [T["events"]["name"], ...T["events"]["name"][]];

  /**
   * A partial map of event handlers keyed by event name. Each entry bundles
   * an `id` function (extracts saga instance ID) and a `handle` function
   * (processes the event). Only events the saga handles need entries —
   * this map is partial over the event union.
   */
  on: SagaOnMap<T, TSagaId>;
}

/**
 * Identity function that creates a saga definition with full type inference
 * across the event/command/state/infrastructure boundaries. This is the
 * recommended way to define sagas.
 *
 * @typeParam T - Inferred {@link SagaTypes} bundle.
 * @typeParam TSagaId - The saga instance identifier type. Bounded by {@link ID}, defaults to `string`.
 * @param config - The saga configuration (initialState, startedBy, on).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const OrderFulfillmentSaga = defineSaga<OrderFulfillmentSagaDef>({
 *   initialState: { status: "pending" },
 *   startedBy: ["OrderPlaced"],
 *   on: {
 *     OrderPlaced: {
 *       id: (event) => event.payload.orderId,
 *       handle: (event, state) => ({
 *         state: { ...state, status: "awaiting_payment" },
 *         commands: {
 *           name: "RequestPayment",
 *           targetAggregateId: event.payload.orderId,
 *           payload: { orderId: event.payload.orderId, amount: event.payload.total },
 *         },
 *       }),
 *     },
 *     PaymentCompleted: {
 *       id: (event) => event.payload.orderId,
 *       handle: (_event, state) => ({
 *         state: { ...state, status: "paid" },
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function defineSaga<T extends SagaTypes, TSagaId extends ID = string>(
  config: Saga<T, TSagaId>,
): Saga<T, TSagaId> {
  return config;
}

// ---- Type inference helpers ----

/**
 * Extracts the saga state type from a {@link Saga} definition.
 *
 * @example
 * ```ts
 * type State = InferSagaState<typeof OrderFulfillmentSaga>;
 * ```
 */
export type InferSagaState<T extends Saga> =
  T extends Saga<infer U> ? U["state"] : never;

/**
 * Extracts the event union type from a {@link Saga} definition.
 *
 * @example
 * ```ts
 * type Events = InferSagaEvents<typeof OrderFulfillmentSaga>;
 * ```
 */
export type InferSagaEvents<T extends Saga> =
  T extends Saga<infer U> ? U["events"] : never;

/**
 * Extracts the command union type from a {@link Saga} definition.
 *
 * @example
 * ```ts
 * type Commands = InferSagaCommands<typeof OrderFulfillmentSaga>;
 * ```
 */
export type InferSagaCommands<T extends Saga> =
  T extends Saga<infer U> ? U["commands"] : never;

/**
 * Extracts the infrastructure type from a {@link Saga} definition.
 *
 * @example
 * ```ts
 * type Infra = InferSagaInfrastructure<typeof OrderFulfillmentSaga>;
 * ```
 */
export type InferSagaInfrastructure<T extends Saga> =
  T extends Saga<infer U> ? U["infrastructure"] : never;

/**
 * Extracts the saga instance ID type from a {@link Saga} definition.
 *
 * @example
 * ```ts
 * type Id = InferSagaId<typeof OrderFulfillmentSaga>; // string
 * ```
 */
export type InferSagaId<T extends Saga> =
  T extends Saga<any, infer TId> ? TId : never;

// ---- Handler-level inference utilities ----

/**
 * Infers the fully-typed saga event handler function for a specific event name
 * within a {@link SagaTypes} bundle. Use this to type extracted saga handlers
 * in separate files without manually reconstructing the function signature.
 *
 * The infrastructure parameter is automatically merged with
 * {@link CQRSInfrastructure} and {@link FrameworkInfrastructure},
 * matching the runtime behavior.
 *
 * Operates on the `SagaTypes` bundle (not the `Saga` definition),
 * so it can be used before `defineSaga` is called.
 *
 * @typeParam T - The {@link SagaTypes} bundle.
 * @typeParam K - The event name literal (a member of `T["events"]["name"]`).
 *
 * @example
 * ```ts
 * // handle-payment-received.ts
 * export const handlePaymentReceived: InferSagaEventHandler<FulfillmentDef, "PaymentReceived"> = (
 *   event, state, { commandBus }
 * ) => ({
 *   state: { ...state, status: "paid" },
 *   commands: { name: "ConfirmOrder", targetAggregateId: state.orderId! },
 * });
 * ```
 */
export type InferSagaEventHandler<
  T extends SagaTypes,
  K extends T["events"]["name"],
> = SagaEventHandler<
  Extract<T["events"], { name: K }>,
  T["state"],
  T["commands"],
  T["infrastructure"]
>;

/**
 * Infers the fully-typed saga on-entry (`{ id, handle }` bundle) for a specific
 * event name within a {@link SagaTypes} bundle. Use this to type extracted
 * saga on-entries in separate files.
 *
 * Operates on the `SagaTypes` bundle (not the `Saga` definition),
 * so it can be used before `defineSaga` is called.
 *
 * @typeParam T - The {@link SagaTypes} bundle.
 * @typeParam K - The event name literal (a member of `T["events"]["name"]`).
 * @typeParam TSagaId - The saga instance identifier type. Bounded by {@link ID}, defaults to `string`.
 *
 * @example
 * ```ts
 * // on-order-placed.ts
 * export const onOrderPlaced: InferSagaOnEntry<FulfillmentDef, "OrderPlaced"> = {
 *   id: (event) => event.payload.orderId,
 *   handle: (event, state) => ({
 *     state: { ...state, status: "awaiting_payment" },
 *     commands: { name: "RequestPayment", ... },
 *   }),
 * };
 * ```
 */
export type InferSagaOnEntry<
  T extends SagaTypes,
  K extends T["events"]["name"],
  TSagaId extends ID = string,
> = SagaOnEntry<
  Extract<T["events"], { name: K }>,
  T["state"],
  T["commands"],
  T["infrastructure"],
  TSagaId
>;
