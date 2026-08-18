/**
 * Thrown by {@link EventBus.on} implementations when a handler is
 * registered for an event name that was not already registered before the
 * bus connected.
 *
 * This is the one contract all broker-backed `EventBus` implementations can
 * honor: a broker consumer subscribes to a fixed set of topics/subjects/queues
 * at connect time, so a genuinely new event name discovered afterward cannot
 * be delivered without re-subscribing (which brokers handle inconsistently
 * or not at all mid-stream). Registering an *additional* handler for an
 * event name that was already registered pre-connect (ordinary fan-out)
 * remains allowed at any time and does not throw this error.
 *
 * @example
 * ```ts
 * await eventBus.connect();
 * eventBus.on("KnownEvent", handler); // fine — was registered pre-connect too
 * eventBus.on("NewEvent", handler);   // throws LateSubscriptionError
 * ```
 */
export class LateSubscriptionError extends Error {
  public override readonly name = "LateSubscriptionError";

  constructor(public readonly eventName: string) {
    super(
      `EventBus: on("${eventName}") called for a new event name after connect(). ` +
        `Register all handlers before calling connect().`,
    );
  }
}
