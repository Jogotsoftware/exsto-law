// Lightweight worker telemetry: throughput, latency, failure counts per job
// kind. Process-local counters surfaced via getWorkerMetrics() and logged on
// each job. A real OpenTelemetry exporter can wrap these later (DoD observability).
export interface JobKindMetrics {
  succeeded: number
  failed: number
  totalLatencyMs: number
  count: number
}

const metrics = new Map<string, JobKindMetrics>()

export function recordJobResult(
  jobKind: string,
  result: 'succeeded' | 'failed',
  latencyMs: number,
): void {
  const m = metrics.get(jobKind) ?? { succeeded: 0, failed: 0, totalLatencyMs: 0, count: 0 }
  m[result] += 1
  m.count += 1
  m.totalLatencyMs += latencyMs
  metrics.set(jobKind, m)
  console.log(
    JSON.stringify({
      kind: 'worker.job',
      jobKind,
      result,
      latencyMs,
      meanLatencyMs: Math.round(m.totalLatencyMs / m.count),
    }),
  )
}

export function getWorkerMetrics(): Record<string, JobKindMetrics & { meanLatencyMs: number }> {
  const out: Record<string, JobKindMetrics & { meanLatencyMs: number }> = {}
  for (const [kind, m] of metrics) {
    out[kind] = { ...m, meanLatencyMs: m.count ? Math.round(m.totalLatencyMs / m.count) : 0 }
  }
  return out
}

export function resetWorkerMetrics(): void {
  metrics.clear()
}
