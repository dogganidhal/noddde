/* eslint-disable no-unused-vars */
import { Event } from "./event";

/**
 * A pure, synchronous function that evolves aggregate state in response to an event.
 * Evolve handlers are the replay engine of event sourcing — they must be deterministic
 * and free of side effects so that replaying events always produces the same state.
 *
 * **Constraints:**
 * - No infrastructure access (no I/O, no external calls).
 * - Must be synchronous (no `async`/`await`).
 * - Must return a new state object (treat state as immutable).
 *
 * @typeParam TEvent - The event type this handler processes.
 * @typeParam TState - The aggregate state type.
 *
 * @param event - The event payload (not the full event envelope).
 * @param state - The current aggregate state before this event.
 * @returns The new aggregate state after evolving with this event.
 */
export type EvolveHandler<TEvent extends Event, TState> = (
  event: TEvent["payload"],
  state: TState,
) => TState;
