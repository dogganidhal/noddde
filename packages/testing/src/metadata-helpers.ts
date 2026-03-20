import type { Event, EventMetadata } from "@noddde/core";

/**
 * Strip metadata from events for payload-only assertions.
 * Useful when you want to assert event name/payload without
 * caring about auto-generated metadata fields.
 */
export function stripMetadata<T extends Event>(
  events: T[],
): Omit<T, "metadata">[] {
  // eslint-disable-next-line no-unused-vars
  return events.map(({ metadata, ...rest }) => rest);
}

/**
 * Assert that an event has valid metadata with all required fields populated.
 * Throws if any required metadata field is missing or invalid.
 */
export function expectValidMetadata(event: Event): void {
  const { metadata } = event;
  if (!metadata) {
    throw new Error(`Event "${event.name}" has no metadata`);
  }
  // eventId should be a UUID v7 (36 chars, matches UUID format)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      metadata.eventId,
    )
  ) {
    throw new Error(
      `Event "${event.name}" has invalid eventId: "${metadata.eventId}" (expected UUID v7)`,
    );
  }
  // timestamp should be valid ISO 8601
  if (isNaN(Date.parse(metadata.timestamp))) {
    throw new Error(
      `Event "${event.name}" has invalid timestamp: "${metadata.timestamp}"`,
    );
  }
  // correlationId and causationId should be non-empty strings
  if (!metadata.correlationId) {
    throw new Error(`Event "${event.name}" has empty correlationId`);
  }
  if (!metadata.causationId) {
    throw new Error(`Event "${event.name}" has empty causationId`);
  }
}

/**
 * Assert all events in array share the same correlationId.
 * Useful for verifying events belong to the same causal chain.
 */
export function expectSameCorrelation(events: Event[]): void {
  if (events.length === 0) return;
  const firstCorrelationId = events[0]!.metadata?.correlationId;
  if (!firstCorrelationId) {
    throw new Error(
      `First event "${events[0]!.name}" has no correlationId in metadata`,
    );
  }
  for (let i = 1; i < events.length; i++) {
    const event = events[i]!;
    if (event.metadata?.correlationId !== firstCorrelationId) {
      throw new Error(
        `Event "${event.name}" at index ${i} has correlationId "${event.metadata?.correlationId}" but expected "${firstCorrelationId}"`,
      );
    }
  }
}

/**
 * Assert events form a causation chain where each event's causationId
 * equals the previous event's eventId.
 */
export function expectCausationChain(events: Event[]): void {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    if (curr.metadata?.causationId !== prev.metadata?.eventId) {
      throw new Error(
        `Event "${curr.name}" at index ${i} has causationId "${curr.metadata?.causationId}" but expected "${prev.metadata?.eventId}" (eventId of previous event "${prev.name}")`,
      );
    }
  }
}

/**
 * Options for creating a deterministic metadata factory for tests.
 */
export interface TestMetadataFactoryOptions {
  /** Generator for event IDs. Default: sequential "evt-1", "evt-2", ... */
  eventIdGenerator?: () => string;
  /** Generator for timestamps. Default: fixed "2024-01-01T00:00:00.000Z" */
  timestampGenerator?: () => string;
  /** Fixed correlation ID. Default: "test-correlation-id" */
  correlationId?: string;
  /** Fixed user ID. Default: undefined */
  userId?: string;
}

/** Context for creating test metadata for a specific event. */
export interface TestMetadataContext {
  aggregateName: string;
  aggregateId: string;
  sequenceNumber: number;
  correlationId?: string;
  causationId?: string;
  userId?: string;
}

/**
 * Create a deterministic metadata factory for tests.
 * Produces predictable eventId and timestamp values for exact assertions.
 */
export function createTestMetadataFactory(
  options?: TestMetadataFactoryOptions,
  // eslint-disable-next-line no-unused-vars
): (ctx: TestMetadataContext) => EventMetadata {
  let counter = 0;
  const eventIdGen = options?.eventIdGenerator ?? (() => `evt-${++counter}`);
  const timestampGen =
    options?.timestampGenerator ?? (() => "2024-01-01T00:00:00.000Z");
  const defaultCorrelationId = options?.correlationId ?? "test-correlation-id";
  const defaultUserId = options?.userId;

  // eslint-disable-next-line no-unused-vars
  return function buildMetadata(ctx: TestMetadataContext): EventMetadata {
    return {
      eventId: eventIdGen(),
      timestamp: timestampGen(),
      correlationId: ctx.correlationId ?? defaultCorrelationId,
      causationId: ctx.causationId ?? "test-causation-id",
      userId: ctx.userId ?? defaultUserId,
      aggregateName: ctx.aggregateName,
      aggregateId: ctx.aggregateId,
      sequenceNumber: ctx.sequenceNumber,
    };
  };
}
