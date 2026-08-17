/* eslint-disable no-unused-vars */

/**
 * Tracing abstraction for framework and adapter instrumentation.
 *
 * `@noddde/core` has zero runtime dependencies, so this interface carries
 * no OpenTelemetry types — it is a thin, transport-agnostic shape that any
 * tracing backend can implement. `@noddde/engine` provides the concrete
 * OpenTelemetry-backed implementation (`OTelInstrumentation`); this
 * interface is what public config surfaces (e.g. messaging adapters) should
 * depend on instead of importing a concrete engine class.
 *
 * @see {@link NoopInstrumentation} for the zero-cost default.
 */
export interface Instrumentation {
  /**
   * Runs `fn` inside a new child span of the active context.
   * On success, sets span status to OK. On error, records the exception
   * and sets span status to ERROR before re-throwing.
   */
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number | undefined>,
    fn: () => Promise<T>,
  ): Promise<T>;

  /**
   * Serializes the active trace context into W3C Trace Context format.
   * Returns `{ traceparent, tracestate }` if a span is active, empty object otherwise.
   */
  injectTraceContext(): { traceparent?: string; tracestate?: string };

  /**
   * Returns the `traceId` and `spanId` from the currently active span.
   * Both fields are absent (not `null`, not empty strings) when no span is
   * active or tracing is not installed.
   */
  getActiveTraceCorrelation(): { traceId?: string; spanId?: string };

  /**
   * Extracts trace context from a carrier (typically event metadata) and
   * runs `fn` inside the restored context. If the carrier has no
   * traceparent, runs `fn` in the current context as-is.
   */
  withExtractedContext<T>(
    carrier: { traceparent?: string; tracestate?: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}

/**
 * No-op {@link Instrumentation} implementation. All methods are zero-cost
 * pass-throughs. The default when no tracing backend is configured.
 */
export class NoopInstrumentation implements Instrumentation {
  async withSpan<T>(
    _name: string,
    _attributes: Record<string, string | number | undefined>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return fn();
  }

  injectTraceContext(): { traceparent?: string; tracestate?: string } {
    return {};
  }

  getActiveTraceCorrelation(): { traceId?: string; spanId?: string } {
    return {};
  }

  async withExtractedContext<T>(
    _carrier: { traceparent?: string; tracestate?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    return fn();
  }
}
