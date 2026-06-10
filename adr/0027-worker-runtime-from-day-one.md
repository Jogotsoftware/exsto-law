# ADR 0027: Worker runtime infrastructure from day one

## Status
Accepted

## Context
Some substrate operations cannot run inline with a request. Time-based jobs (a reminder fires in an hour, a digest sends every morning) require a scheduler. Long-running operations (re-projection of historical events, bulk identity resolution) cannot block a UI request. Asynchronous integrations (a webhook arrives, the substrate processes it later) need a queue.

Without a worker runtime, these patterns get implemented ad-hoc. A scheduler becomes a cron job. A queue becomes "fire and forget HTTP calls." Re-projection becomes a manual script. Each ad-hoc solution accumulates its own bugs and operational debt.

For Exsto, the reference app needs reminders from day one. Future ingestion adapters will need queue-based processing. The substrate is reactive: events trigger workflows, projections, notifications. All of this requires a worker.

The question is not whether to build worker infrastructure. The question is whether to build it now or defer until "we need it."

## Decision
Worker runtime infrastructure ships as part of Layer 0-2.

`workers/runtime/` contains:
- A queue (initial implementation: Postgres-backed via pg-boss or equivalent)
- A scheduler (cron-like, evaluated against the queue)
- A dispatcher (pulls jobs, sets tenant context per ADR 0001, invokes handlers)
- A handler registration interface (handlers register on startup; the runtime does not change to add new handler types)
- Retry with exponential backoff
- A dead-letter queue for jobs that fail repeatedly
- Telemetry on throughput, latency, failure rates

Specific worker types (ingestion, identity resolution, notification dispatch) are NOT in scope for Layer 0-2. They get added when their use cases are real. The runtime that will host them is in scope now.

The reference app exercises the runtime. Reminders fire on schedule. Workflow advancement runs through the worker. The runtime is proven before any customer engagement.

## Consequences

What's now easier:
- Time-based and async work has a home from day one. Reminders, projections, scheduled jobs all use the same infrastructure.
- Adding a new handler is a code drop, not infrastructure work.
- The reference app smoke-tests the runtime under daily use.

What's now harder:
- Initial scaffolding effort. The runtime is built before the first job exists. Acceptable: this is the foundation discipline.
- Operational story. A worker process is one more thing to monitor, deploy, and scale.

## Alternatives considered

**Defer worker infrastructure until needed.** Rejected: "until needed" arrives sooner than expected and the infrastructure is harder to retrofit cleanly. Reminders in the reference app are needed from day one.

**Use a SaaS queue (SQS, Inngest, Trigger.dev).** Considered. Adds vendor relationship and cost. Pg-boss on Supabase Postgres is sufficient for current scale and zero additional vendors. If scale demands, we can swap the queue implementation behind the same handler interface.

**One worker per concern (one for ingestion, one for projections, etc.).** Rejected: premature subdivision. A single runtime with multiple handler types is simpler. Subdivision happens when operational pressure demands it.

**Edge functions / serverless for async work.** Considered. Supabase Edge Functions handle some cases. Long-running and stateful work fits a worker process better. Use edge functions for low-volume, low-latency webhooks; use the worker runtime for substantive async work.
