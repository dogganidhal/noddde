import type { ID } from "../id";

/**
 * Metadata envelope attached to domain events by the framework at dispatch
 * time. Carries audit, tracing, and sequencing information that enables
 * correlation across aggregates/sagas, compliance audit trails, and event
 * store ordering.
 *
 * Command handlers never produce metadata — the engine's {@link Domain}
 * auto-populates it during command dispatch.
 */
export interface EventMetadata {
  /** Globally unique event identifier (UUID v7, time-ordered). */
  eventId: string;
  /** ISO 8601 timestamp of when the event was produced. */
  timestamp: string;
  /**
   * Traces a user action across aggregates and sagas.
   * All events in a causal chain share the same correlationId.
   */
  correlationId: string;
  /**
   * ID of the command or event that directly caused this event.
   *
   * Must be a per-dispatch identifier — the causing command's `commandId`
   * or the causing event's `eventId` — never a static command/event name.
   * A causation chain built from names instead of ids collapses every
   * dispatch of the same command into one indistinguishable value, which
   * defeats the field's purpose (audit/debugging tooling built on
   * causation graphs) and cannot be repaired retroactively once persisted.
   */
  causationId: string;
  /** Who initiated the action (set via metadata context or provider). */
  userId?: ID;
  /** Event schema version for future evolution support. */
  version?: number;
  /** Which aggregate type produced this event. */
  aggregateName?: string;
  /** Which aggregate instance produced this event. */
  aggregateId?: ID;
  /** Position in the aggregate's event stream. */
  sequenceNumber?: number;
  /**
   * W3C Trace Context traceparent header. Injected by the engine when
   * OpenTelemetry is detected at runtime. Enables distributed trace
   * propagation through the event store.
   */
  traceparent?: string;
  /**
   * W3C Trace Context tracestate header. Carries vendor-specific trace
   * information alongside {@link traceparent}.
   */
  tracestate?: string;
}
