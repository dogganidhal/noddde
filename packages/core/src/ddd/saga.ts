import { Event } from "../edd/event";
import { Command } from "../cqrs/command/command";
import { Infrastructure, CQRSInfrastructure } from "../infrastructure";

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
  infrastructure: TInfrastructure & CQRSInfrastructure,
) =>
  | SagaReaction<TState, TCommands>
  | Promise<SagaReaction<TState, TCommands>>;

// ---- Internal handler maps ----

/**
 * Maps each event name to its handler, with the event type narrowed
 * via Extract. Follows the same pattern as `CommandHandlerMap` for
 * aggregates and `ReducerMap` for projections.
 */
type SagaEventHandlerMap<T extends SagaTypes> = {
  [K in T["events"]["name"]]: SagaEventHandler<
    Extract<T["events"], { name: K }>,
    T["state"],
    T["commands"],
    T["infrastructure"]
  >;
};

/**
 * Maps each event name to a function that extracts the saga instance ID
 * from that event. This is how the framework routes incoming events to
 * the correct saga instance.
 *
 * Analogous to `targetAggregateId` on commands, but since events don't
 * carry a saga ID natively, the association must be user-defined per
 * event type.
 */
type SagaAssociationMap<T extends SagaTypes, TSagaId = string> = {
  [K in T["events"]["name"]]: (
    event: Extract<T["events"], { name: K }>,
  ) => TSagaId;
};

// ---- Saga definition ----

/**
 * A saga definition following the process manager pattern: initial state,
 * event handlers (react), association logic (identity), and lifecycle
 * declaration (startedBy). No base classes, no decorators — just a typed object.
 *
 * Use {@link defineSaga} to create a saga with full type inference.
 *
 * @typeParam T - The {@link SagaTypes} bundle for this saga.
 * @typeParam TSagaId - The saga instance identifier type (defaults to `string`).
 */
export interface Saga<T extends SagaTypes = SagaTypes, TSagaId = string> {
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
   * Maps each event to a function that extracts the saga instance ID.
   * Every event the saga handles must have an association entry so
   * the runtime can route the event to the correct saga instance.
   */
  associations: SagaAssociationMap<T, TSagaId>;

  /**
   * A map of event handlers keyed by event name. Each handler implements
   * the "react" phase: `(event, state, infrastructure) => { state, commands }`.
   */
  handlers: SagaEventHandlerMap<T>;
}

/**
 * Identity function that creates a saga definition with full type inference
 * across the event/command/state/infrastructure boundaries. This is the
 * recommended way to define sagas.
 *
 * @typeParam T - Inferred {@link SagaTypes} bundle.
 * @typeParam TSagaId - The saga instance identifier type (defaults to `string`).
 * @param config - The saga configuration (initialState, startedBy,
 *   associations, handlers).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const OrderFulfillmentSaga = defineSaga<OrderFulfillmentSagaDef>({
 *   initialState: { status: "pending" },
 *   startedBy: ["OrderPlaced"],
 *   associations: {
 *     OrderPlaced: (event) => event.payload.orderId,
 *     PaymentCompleted: (event) => event.payload.orderId,
 *     ShipmentDispatched: (event) => event.payload.orderId,
 *   },
 *   handlers: {
 *     OrderPlaced: (event, state) => ({
 *       state: { ...state, status: "awaiting_payment" },
 *       commands: {
 *         name: "RequestPayment",
 *         targetAggregateId: event.payload.paymentId,
 *         payload: { orderId: event.payload.orderId, amount: event.payload.total },
 *       },
 *     }),
 *     // ...
 *   },
 * });
 * ```
 */
export function defineSaga<T extends SagaTypes, TSagaId = string>(
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
