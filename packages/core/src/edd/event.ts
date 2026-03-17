/**
 * Base interface for all domain events. Events represent facts — things that
 * have already happened within the domain. They are immutable and named in
 * the past tense.
 *
 * Use {@link DefineEvents} to build event unions from a payload map instead
 * of declaring each event interface manually.
 */
export interface Event {
  /** Discriminant field used to identify the event type and enable type narrowing. */
  name: string;
  /** The event's data describing what happened. */
  payload: any;
}

/**
 * Builds a discriminated union of event types from a payload map.
 * Each key becomes an event `name`, and the value becomes its `payload` type.
 *
 * @typeParam TPayloads - A record mapping event names to their payload types.
 *
 * @example
 * ```ts
 * type AccountEvent = DefineEvents<{
 *   AccountCreated: { id: string; owner: string };
 *   DepositMade: { amount: number };
 * }>;
 * // Equivalent to:
 * // | { name: "AccountCreated"; payload: { id: string; owner: string } }
 * // | { name: "DepositMade"; payload: { amount: number } }
 * ```
 */
export type DefineEvents<TPayloads extends Record<string, any>> = {
  [K in keyof TPayloads & string]: { name: K; payload: TPayloads[K] };
}[keyof TPayloads & string];
