# Cross-cutting infrastructure

This package holds the things every other package needs.

## What lives here

- Common types (UUID, TenantId, ActorId, ActionId, EntityId, etc.)
- Error classes (TenancyViolation, GovernanceDenied, ContestationDetected, etc.)
- Telemetry setup (OpenTelemetry tracer, structured logger)
- Configuration loading (env var parsing, validation)
- Database client wrapped to require tenant context binding
- Time precision utilities

## Hard rules

1. No business logic. This package is plumbing only. Business logic belongs in packages/primitives or packages/substrate.
2. No imports from other workspace packages. This package is a leaf in the dependency graph.
