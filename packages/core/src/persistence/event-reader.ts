/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import type { Event } from "../edd/event";

/**
 * Optional filter and cursor for {@link EventReader.read}.
 *
 * v1 of the engine always calls `read({})` with no options. Adapters MAY
 * implement filtering and cursoring; the shape is reserved here so adapter
 * implementations can ship the capability ahead of engine consumers.
 */
export interface EventReadOptions {
  /**
   * Filter the stream to events belonging to aggregates of this name.
   * When omitted, events from all aggregates are streamed.
   */
  aggregateName?: string;

  /**
   * Resume after the given aggregate-version cursor. Adapter-defined
   * semantics; reserved for future use. v1 engine code does not pass this.
   */
  after?: {
    aggregateName: string;
    aggregateId: ID;
    version: number;
  };
}

/**
 * Read-only access to the global event log.
 *
 * Implementations expose every persisted event as an async iterable. The
 * engine consumes this iterable lazily — adapters SHOULD stream from
 * underlying storage (cursor / paged query / change feed) rather than
 * materializing the full log in memory.
 */
export interface EventReader {
  /**
   * Returns an async iterable that yields events in the log's append order.
   *
   * Ordering guarantees:
   *
   *  - Within a single aggregate stream `(aggregateName, aggregateId)`,
   *    events MUST be yielded in `version` order (0, 1, 2, ...).
   *
   *  - Across different aggregates, ordering is adapter-defined but MUST be
   *    stable for a single call (replaying with the same options on a frozen
   *    log returns the same sequence). Adapters that record a global
   *    sequence number SHOULD yield in that order; adapters that don't MAY
   *    interleave aggregate streams in any deterministic-for-this-call
   *    fashion.
   *
   *  - Implementations MUST yield each event at most once per call.
   *
   * Iteration is single-pass: callers MUST consume the returned iterable
   * exactly once. Re-calling `read()` is the way to start a fresh traversal.
   */
  read(options?: EventReadOptions): AsyncIterable<Event>;
}
