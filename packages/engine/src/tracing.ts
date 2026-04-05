/**
 * Native OpenTelemetry instrumentation for the noddde engine.
 *
 * Detects `@opentelemetry/api` at runtime via dynamic `import()`.
 * When present, creates spans at pipeline stages and propagates
 * W3C Trace Context through event metadata. When absent, all
 * methods are zero-cost no-ops.
 *
 * @internal Not exported from `@noddde/engine` public API.
 */

/**
 * Resolved OpenTelemetry API bindings, or null when `@opentelemetry/api`
 * is not installed in the host application.
 */
export type OTelApi = {
  trace: typeof import("@opentelemetry/api").trace;
  context: typeof import("@opentelemetry/api").context;
  propagation: typeof import("@opentelemetry/api").propagation;
  SpanStatusCode: typeof import("@opentelemetry/api").SpanStatusCode;
};

/**
 * Attempts to dynamically import `@opentelemetry/api` at runtime.
 * Returns the API bindings if the package is installed, `null` otherwise.
 * Called once during `Domain.init()`.
 */
export async function detectOTel(): Promise<OTelApi | null> {
  try {
    const api = await import("@opentelemetry/api");
    return {
      trace: api.trace,
      context: api.context,
      propagation: api.propagation,
      SpanStatusCode: api.SpanStatusCode,
    };
  } catch {
    return null;
  }
}

/**
 * Thin, safe wrapper around OTel APIs. All methods are no-ops when
 * constructed with `null` (i.e. `@opentelemetry/api` is not installed).
 */
export class Instrumentation {
  private readonly otel: OTelApi | null;
  private readonly tracer: any; // OTel Tracer or null

  constructor(otel: OTelApi | null) {
    this.otel = otel;
    this.tracer = otel ? otel.trace.getTracer("@noddde/engine", "0.0.0") : null;
  }

  /**
   * Runs `fn` inside a new child span of the active context.
   * On success, sets span status to OK. On error, records the exception
   * and sets span status to ERROR before re-throwing.
   */
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | undefined>,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.otel || !this.tracer) {
      return fn();
    }

    const { context, trace, SpanStatusCode } = this.otel;
    const span = this.tracer.startSpan(name, { attributes });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error: unknown) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Serializes the active trace context into W3C Trace Context format.
   * Returns `{ traceparent, tracestate }` if a span is active, empty object otherwise.
   */
  injectTraceContext(): { traceparent?: string; tracestate?: string } {
    if (!this.otel) {
      return {};
    }

    const carrier: Record<string, string> = {};
    this.otel.propagation.inject(this.otel.context.active(), carrier);

    const result: { traceparent?: string; tracestate?: string } = {};
    if (carrier["traceparent"]) {
      result.traceparent = carrier["traceparent"];
    }
    if (carrier["tracestate"]) {
      result.tracestate = carrier["tracestate"];
    }
    return result;
  }

  /**
   * Extracts trace context from a carrier (typically event metadata) and
   * runs `fn` inside the restored context. If carrier has no traceparent,
   * runs `fn` in the current context as-is.
   */
  async withExtractedContext<T>(
    carrier: { traceparent?: string; tracestate?: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.otel || !carrier.traceparent) {
      return fn();
    }

    const extractedCtx = this.otel.propagation.extract(
      this.otel.context.active(),
      carrier,
    );
    return this.otel.context.with(extractedCtx, fn);
  }
}
