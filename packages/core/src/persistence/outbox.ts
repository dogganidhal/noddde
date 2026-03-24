/* eslint-disable no-unused-vars */
import type { Event } from "../edd";

/**
 * A single outbox entry representing a domain event pending publication.
 * Written atomically with aggregate persistence within a UnitOfWork.
 * Read by the OutboxRelay for guaranteed delivery.
 */
export interface OutboxEntry {
  /** Unique entry identifier (UUID v7, time-ordered). */
  id: string;
  /** The fully enriched domain event to publish. */
  event: Event;
  /** Which aggregate type produced this event (for debugging/filtering). */
  aggregateName?: string;
  /** Which aggregate instance produced this event (for debugging/filtering). */
  aggregateId?: string;
  /** ISO 8601 timestamp of when the entry was created. */
  createdAt: string;
  /** ISO 8601 timestamp of when the entry was published, or null if pending. */
  publishedAt: string | null;
}

/**
 * Storage interface for the transactional outbox.
 * Implementations must support atomic writes within a UnitOfWork
 * and polling reads for the OutboxRelay.
 *
 * @see {@link OutboxEntry} for the entry shape.
 */
export interface OutboxStore {
  /**
   * Persists one or more outbox entries. Designed to be called within
   * a UoW's enlisted operation to ensure atomicity with aggregate persistence.
   *
   * @param entries - The outbox entries to persist.
   */
  save(entries: OutboxEntry[]): Promise<void>;

  /**
   * Loads unpublished entries ordered by createdAt (oldest first).
   * Used by the OutboxRelay to poll for pending events.
   *
   * @param batchSize - Maximum number of entries to return. Defaults to 100.
   */
  loadUnpublished(batchSize?: number): Promise<OutboxEntry[]>;

  /**
   * Marks entries as published by setting their publishedAt timestamp.
   * Called after the relay successfully dispatches the events.
   *
   * @param ids - The entry IDs to mark as published.
   */
  markPublished(ids: string[]): Promise<void>;

  /**
   * Marks entries as published by matching on their event's metadata.eventId.
   * Used for happy-path post-dispatch marking where only the dispatched
   * Event[] is available (outbox entry IDs are not accessible to the caller).
   *
   * @param eventIds - The event metadata eventIds to match.
   */
  markPublishedByEventIds(eventIds: string[]): Promise<void>;

  /**
   * Removes published entries older than the given date.
   * Used for periodic cleanup to prevent unbounded growth.
   *
   * @param olderThan - Cutoff date. Published entries created before this
   *   date are removed. If omitted, all published entries are removed.
   */
  deletePublished(olderThan?: Date): Promise<void>;
}
