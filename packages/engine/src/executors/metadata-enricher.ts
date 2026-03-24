/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Event, ID } from "@noddde/core";
import { uuidv7 } from "../uuid";
import type { MetadataContext, MetadataProvider } from "../domain";

/**
 * Enriches raw events produced by command handlers with metadata
 * (eventId, timestamp, correlationId, causationId, userId, aggregate
 * context, and sequenceNumber).
 *
 * Merges three metadata sources in priority order:
 * 1. `withMetadataContext` override (highest priority)
 * 2. Configured `MetadataProvider` callback
 * 3. Auto-generated defaults (lowest priority)
 *
 * @internal Not exported — used by {@link CommandLifecycleExecutor}.
 */
export class MetadataEnricher {
  constructor(
    private readonly metadataStorage: AsyncLocalStorage<MetadataContext>,
    private readonly metadataProvider?: MetadataProvider,
  ) {}

  /**
   * Returns a new array of events with fully populated metadata.
   *
   * @param events - Raw events from the command handler (no metadata).
   * @param aggregateName - The aggregate type that produced these events.
   * @param aggregateId - The aggregate instance that produced these events.
   * @param version - The aggregate version before these events (used for sequenceNumber).
   * @param causationFallback - Fallback causationId (typically the command name).
   * @param eventVersionResolver - Optional function that returns the current schema
   *   version for an event name. When provided, sets `metadata.version` on each event.
   * @returns New event objects with metadata attached.
   */
  enrich(
    events: Event[],
    aggregateName: string,
    aggregateId: ID,
    version: number,
    causationFallback: string,
    eventVersionResolver?: (eventName: string) => number,
  ): Event[] {
    const providerCtx = this.metadataProvider?.() ?? {};
    const overrideCtx = this.metadataStorage.getStore() ?? {};
    const mergedCtx = { ...providerCtx, ...overrideCtx };

    // Compute correlationId once so all events in the batch share it
    const correlationId = mergedCtx.correlationId ?? uuidv7();
    const causationId = mergedCtx.causationId ?? causationFallback;

    return events.map((event, index) => ({
      ...event,
      metadata: {
        eventId: uuidv7(),
        timestamp: new Date().toISOString(),
        correlationId,
        causationId,
        userId: mergedCtx.userId,
        version: eventVersionResolver?.(event.name),
        aggregateName,
        aggregateId,
        sequenceNumber: version + index + 1,
      },
    }));
  }
}
