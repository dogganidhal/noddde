/* eslint-disable no-unused-vars */
import type { Event } from "./event";

/**
 * Extracts the last element of a tuple type.
 *
 * @example
 * ```ts
 * type L = Last<[string, number, boolean]>; // boolean
 * ```
 */
export type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;

/**
 * Recursive mapped tuple type that generates step function signatures
 * from a version tuple. Each step transforms from one version to the next.
 *
 * @example
 * ```ts
 * type S = StepsFromVersions<[V1, V2, V3]>;
 * // [(payload: V1) => V2, (payload: V2) => V3]
 * ```
 */
export type StepsFromVersions<T extends any[]> = T extends [
  infer V1,
  infer V2,
  ...infer Rest,
]
  ? [(payload: V1) => V2, ...StepsFromVersions<[V2, ...Rest]>]
  : [];

/**
 * A phantom-branded array type that carries the upcaster chain's final
 * output type at the type level. At runtime, it is a plain array of
 * payload transform functions. The phantom `__outputType` field enables
 * {@link UpcasterMap} to validate that the chain's final output matches
 * the current event payload type.
 *
 * @typeParam TOutput - The payload type produced by the last step in the chain.
 */
export type TypedEventUpcasterChain<TOutput> = Array<(payload: any) => any> & {
  readonly __outputType?: TOutput;
};

/**
 * A mapped type that associates event names with their typed upcaster chains.
 * Keys are constrained to valid event names from `TEvents`, and each chain's
 * phantom output type must be assignable to the corresponding event's current
 * payload type.
 *
 * Only events that have undergone schema changes need entries; omitted events
 * are assumed to be at version 1 (never changed).
 *
 * @typeParam TEvents - The discriminated union of all event types.
 */
export type UpcasterMap<TEvents extends Event = Event> = {
  [K in TEvents["name"]]?: TypedEventUpcasterChain<
    Extract<TEvents, { name: K }>["payload"]
  >;
};

/**
 * Creates a typed upcaster chain from a version tuple. The version tuple
 * declares all payload shapes (historical and current) upfront, and each
 * step function's input/output types are derived from it.
 *
 * The version tuple **must** be explicitly provided as a generic parameter
 * (TypeScript cannot infer it from the step functions).
 *
 * @typeParam TVersions - A tuple of payload types `[V1, V2, ...]` where
 *   each element represents a schema version. Must have at least 2 elements.
 * @param steps - Transform functions, one per version transition.
 * @returns A {@link TypedEventUpcasterChain} branded with the last version type.
 *
 * @example
 * ```ts
 * type V1 = { id: string };
 * type V2 = { id: string; status: string };
 *
 * const chain = defineEventUpcasterChain<[V1, V2]>(
 *   (v1) => ({ ...v1, status: "active" }),
 * );
 * ```
 */
export function defineEventUpcasterChain<
  TVersions extends [any, any, ...any[]],
>(
  ...steps: StepsFromVersions<TVersions>
): TypedEventUpcasterChain<Last<TVersions>> {
  return steps as unknown as TypedEventUpcasterChain<Last<TVersions>>;
}

/**
 * Identity function for creating type-safe upcaster maps. Provides
 * type inference and validation that event names and chain output types
 * match the event union.
 *
 * @typeParam TEvents - The discriminated union of all event types.
 * @param upcasters - The upcaster map to validate.
 * @returns The same map, fully typed.
 *
 * @example
 * ```ts
 * const upcasters = defineUpcasters<BankAccountEvent>({
 *   AccountCreated: defineEventUpcasterChain<[V1, V2]>(
 *     (v1) => ({ ...v1, status: "active" }),
 *   ),
 * });
 * ```
 */
export function defineUpcasters<TEvents extends Event>(
  upcasters: UpcasterMap<TEvents>,
): UpcasterMap<TEvents> {
  return upcasters;
}

/**
 * Applies an upcaster chain to a single event, transforming its payload
 * from the stored version to the current version. Returns a new event
 * object with the upcasted payload — the input is never mutated.
 *
 * If no chain exists for the event's name, or if the event is already
 * at (or beyond) the current version, the original event is returned
 * as-is (same reference).
 *
 * @param event - The event to upcast.
 * @param upcasters - The upcaster map containing chains per event name.
 * @returns A new event with the upcasted payload, or the original event.
 */
export function upcastEvent(event: Event, upcasters: UpcasterMap): Event {
  const chain = upcasters[event.name as keyof typeof upcasters] as
    | TypedEventUpcasterChain<any>
    | undefined;
  if (!chain || chain.length === 0) {
    return event;
  }

  const storedVersion = event.metadata?.version ?? 1;
  const currentVersion = chain.length + 1;

  if (storedVersion >= currentVersion) {
    return event;
  }

  let payload = event.payload;
  for (let i = storedVersion - 1; i < chain.length; i++) {
    payload = chain[i]!(payload);
  }

  return { ...event, payload };
}

/**
 * Applies upcaster chains to an array of events. Each event is individually
 * upcasted via {@link upcastEvent}.
 *
 * @param events - The events to upcast.
 * @param upcasters - The upcaster map containing chains per event name.
 * @returns A new array of upcasted events.
 */
export function upcastEvents(events: Event[], upcasters: UpcasterMap): Event[] {
  return events.map((event) => upcastEvent(event, upcasters));
}

/**
 * Returns the current schema version for an event name based on its
 * upcaster chain. If no chain exists, the current version is 1.
 *
 * @param eventName - The event name to look up.
 * @param upcasters - The upcaster map containing chains per event name.
 * @returns The current version number (always >= 1).
 */
export function currentEventVersion(
  eventName: string,
  upcasters: UpcasterMap,
): number {
  const chain = upcasters[eventName as keyof typeof upcasters] as
    | TypedEventUpcasterChain<any>
    | undefined;
  if (!chain) {
    return 1;
  }
  return chain.length + 1;
}
