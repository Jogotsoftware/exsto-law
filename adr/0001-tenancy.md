# ADR 0001: Tenancy enforced at the database layer

## Status
Accepted

## Context
Exsto is multi-tenant. Multiple customer organizations share one running substrate. Their data must never mix.

In application-layer tenancy, every query has a `WHERE tenant_id = ?` clause. The application is responsible for adding it. One missed filter, anywhere in the codebase, leaks data across tenants. The leak might be silent for weeks. Recovery is brutal: legal disclosure, customer trust loss, possible loss of the company.

The substrate is the foundation. A tenancy bug here is unrecoverable. We cannot ship code that depends on every developer remembering to filter every query.

## Decision
Tenancy is enforced at the Postgres layer using row-level security (RLS).

Every table that holds tenant data has a `tenant_id` column. RLS is enabled on every such table. The policy is uniform:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Every database connection sets `app.tenant_id` at the start of the request, job, or session. Code that forgets to set it cannot read or write tenant data; the database refuses.

Tables without `tenant_id` (system-wide configuration like `system_capability_registry`) have RLS disabled deliberately, with documented reasoning per table.

The rule applies uniformly: substrate, primitives, MCP tools, workers, the reference app. No admin path bypasses RLS in production code. Admin operations use a separate elevated path with explicit logging.

## Consequences

What's now easier:
- A tenancy bug in application code cannot leak data. The database is the gate.
- Audits and compliance work is simpler. Tenancy is provable structurally, not by inspection of every query.
- New developers cannot accidentally leak tenant data.

What's now harder:
- Every connection must set `app.tenant_id`. Discipline applied at every boundary (HTTP request handlers, worker job handlers, scheduled tasks). Forgetting causes "no rows returned" errors that are loud, not silent.
- Performance has small RLS overhead per query (single-digit milliseconds). Profiled and within budget.
- Connection pooling needs care. A pooled connection retains its `app.tenant_id` setting; if not reset, the next request sees the previous tenant's data. Solution: reset at the start of every checkout.
- Cross-tenant queries (system metrics, internal admin) need an elevated path. Built deliberately with logging, not as a general-purpose bypass.

## Alternatives considered

**Application-layer filtering.** Every query manually scoped. Rejected: relies on perfect developer discipline forever. One missed filter is a leak.

**Tenant-as-database (separate Postgres schema per tenant).** Rejected: operationally expensive (migrations run per schema, backups branch per tenant). Doesn't scale to thousands of tenants. Doesn't prevent the "app code points to wrong schema" failure mode at the database layer.

**Separate physical database per tenant.** Strongest isolation. Rejected: operational cost is enormous. Cross-tenant analytics become a federation problem. Migration coordination becomes a nightmare.

**Hybrid (RLS plus per-tenant database for high-trust customers).** Considered, deferred. RLS is sufficient for current requirements. If a customer demands physical isolation later, we add a deployment mode; we do not change the substrate model.
