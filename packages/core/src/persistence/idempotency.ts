/* eslint-disable no-unused-vars */
import type { ID } from "../id";

/**
 * A record of a processed command, stored by the {@link IdempotencyStore}.
 * Captures the metadata of a command that has been successfully executed,
 * enabling duplicate detection on subsequent dispatches.
 */
export interface IdempotencyRecord {
  /** The unique command identifier that was processed. */
  commandId: ID;
  /** The aggregate type that processed the command. */
  aggregateName: string;
  /** The aggregate instance that processed the command. */
  aggregateId: ID;
  /** ISO 8601 timestamp of when the command was processed. */
  processedAt: string;
}

/**
 * Storage interface for tracking processed commands.
 * Used by the domain engine to detect and skip duplicate commands
 * when a command carries a `commandId`.
 *
 * Implementations must support save-then-exists round-trips and
 * TTL-based cleanup of expired records.
 *
 * @see {@link IdempotencyRecord} for the record data structure.
 */
export interface IdempotencyStore {
  /**
   * Checks whether a command with the given ID has already been processed.
   * Returns `true` if a record exists (and has not expired), `false` otherwise.
   *
   * This is a fast-path check only, subject to a check-then-act race under
   * concurrency. The authoritative duplicate signal is an
   * {@link IdempotencyConflictError} thrown from {@link save}.
   *
   * @param commandId - The unique command identifier to check.
   */
  exists(commandId: ID): Promise<boolean>;

  /**
   * Atomically claims a command as processed. Called within the UoW
   * to ensure atomicity with event persistence.
   *
   * Throws {@link IdempotencyConflictError} if a (non-expired) record with
   * the same `commandId` already exists — this is the authoritative
   * duplicate signal, unlike the best-effort {@link exists} fast-path.
   *
   * @param record - The idempotency record to persist.
   */
  save(record: IdempotencyRecord): Promise<void>;

  /**
   * Removes a single idempotency record. No-op if the record does not exist.
   *
   * @param commandId - The unique command identifier to remove.
   */
  remove(commandId: ID): Promise<void>;

  /**
   * Removes all records whose `processedAt` timestamp is older than
   * `Date.now() - ttlMs`. Returns successfully even if no records
   * were removed.
   *
   * @param ttlMs - The time-to-live in milliseconds. Records older than
   *   this threshold are removed.
   */
  removeExpired(ttlMs: number): Promise<void>;
}
