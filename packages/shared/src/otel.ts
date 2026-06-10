// Opt-in OpenTelemetry exporter wiring. Call startTracing() once at process start
// (MCP server, REST API, worker) BEFORE the first span. When
// OTEL_EXPORTER_OTLP_ENDPOINT is unset this is a no-op, so the substrate's withSpan
// calls stay no-op in dev/test. Kept separate from ./telemetry.ts so the always-on
// tracing code depends only on @opentelemetry/api (no SDK at import time).
//
// The SDK packages are OPTIONAL dependencies, loaded dynamically only when tracing
// is enabled. They are treated as untyped here on purpose: the exact SDK versions
// are the deployer's choice, and pinning them in this package's types would couple
// the always-on instrumentation to one SDK release line. The OTel API contract
// (provider.register()) is stable across those releases.
/* eslint-disable @typescript-eslint/no-explicit-any */
let started = false

export async function startTracing(serviceName: string): Promise<void> {
  if (started) return
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return // tracing disabled; withSpan stays no-op
  started = true

  const sdkNode: any = await import('@opentelemetry/sdk-trace-node')
  const sdkBase: any = await import('@opentelemetry/sdk-trace-base')
  const otlp: any = await import('@opentelemetry/exporter-trace-otlp-http')
  const resources: any = await import('@opentelemetry/resources')
  const semconv: any = await import('@opentelemetry/semantic-conventions')

  const exporter = new otlp.OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
  const provider = new sdkNode.NodeTracerProvider({
    resource: resources.resourceFromAttributes({ [semconv.ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [new sdkBase.BatchSpanProcessor(exporter)],
  })
  provider.register()
  console.error(`[otel] tracing enabled for ${serviceName} -> ${endpoint}`)
}
