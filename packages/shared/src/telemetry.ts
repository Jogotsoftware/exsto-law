// OpenTelemetry tracing + a lightweight latency recorder for the substrate.
//
// Tracing uses the OTel API only (a no-op unless a provider is registered), so it
// is always safe to call and adds ~nothing when disabled. Wire a real exporter at
// process start with startTracing() (see ./otel.ts) when OTEL_EXPORTER_OTLP_ENDPOINT
// is set. The latency recorder is always-on and in-process — it backs the 50ms
// perf-budget measurement (scripts/perf-budget.mjs) without needing a collector.
import { trace, SpanStatusCode, type Span, type Attributes, type Tracer } from '@opentelemetry/api'

const TRACER_NAME = 'exsto-substrate'

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME)
}

// In-process latency samples per operation name (ms). Bounded so a long-running
// process never grows unbounded; the perf script resets between runs.
const samples = new Map<string, number[]>()
const MAX_SAMPLES = 10_000

export function recordLatency(operation: string, ms: number): void {
  let arr = samples.get(operation)
  if (!arr) {
    arr = []
    samples.set(operation, arr)
  }
  if (arr.length < MAX_SAMPLES) arr.push(ms)
}

export interface LatencyStats {
  operation: string
  count: number
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

export function getLatencyStats(): LatencyStats[] {
  const out: LatencyStats[] = []
  for (const [operation, arr] of samples) {
    const sorted = [...arr].sort((a, b) => a - b)
    const sum = sorted.reduce((s, v) => s + v, 0)
    out.push({
      operation,
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] ?? 0,
      mean: sorted.length ? sum / sorted.length : 0,
    })
  }
  return out.sort((a, b) => a.operation.localeCompare(b.operation))
}

export function resetLatency(): void {
  samples.clear()
}

// Run `fn` inside a span named `name`. Records the duration as a latency sample,
// sets span attributes, and marks the span errored if fn throws. The span time and
// latency sample bracket exactly fn — for substrate operations that is the action
// layer's own work (transaction + handlers).
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  const tracer = getTracer()
  const startedAt = performance.now()
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message })
      span.recordException(err as Error)
      throw err
    } finally {
      const ms = performance.now() - startedAt
      span.setAttribute('exsto.latency_ms', Math.round(ms * 100) / 100)
      recordLatency(name, ms)
      span.end()
    }
  })
}
