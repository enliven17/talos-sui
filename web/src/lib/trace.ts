/**
 * Lightweight tracing wrapper.
 *
 * We don't pull in @opentelemetry — the dependency surface is huge for
 * the value we get on a hackathon submission. Instead we expose a
 * minimal `withSpan` that:
 *
 *   1. Times the wrapped async function.
 *   2. Logs structured JSON to stdout (Vercel automatically forwards to
 *      its observability sink + any external log drains).
 *   3. Surfaces a trace id you can correlate across logs.
 *
 * If you later wire up a real OpenTelemetry collector, swap the
 * implementation here and every existing call site keeps working.
 */

let counter = 0;

function makeTraceId(): string {
  counter = (counter + 1) >>> 0;
  return `trace_${Math.floor(Date.now() / 1000).toString(36)}_${counter.toString(36)}`;
}

interface SpanAttributes {
  [k: string]: string | number | boolean | null | undefined;
}

export interface SpanResult<T> {
  result: T;
  traceId: string;
  durationMs: number;
}

/**
 * Wrap an async operation in a logged span.
 *
 * Example:
 *   const { result } = await withSpan("walrus.store", { bytes: data.length },
 *     () => storeJsonOnWalrus(payload));
 */
export async function withSpan<T>(
  name: string,
  attrs: SpanAttributes,
  fn: () => Promise<T>,
): Promise<SpanResult<T>> {
  const traceId = makeTraceId();
  const startedAt = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        severity: "INFO",
        kind: "span",
        name,
        traceId,
        durationMs,
        ok: true,
        attrs,
      }),
    );
    return { result, traceId, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      JSON.stringify({
        severity: "ERROR",
        kind: "span",
        name,
        traceId,
        durationMs,
        ok: false,
        error: message,
        attrs,
      }),
    );
    throw err;
  }
}

/**
 * Convenience: a span helper that swallows the result type and just
 * returns the value (no trace metadata). Use this when you don't care
 * about the trace id at the call site.
 */
export async function span<T>(
  name: string,
  attrs: SpanAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  return (await withSpan(name, attrs, fn)).result;
}
