# ADR 0039: migration_job is a lifecycle table; fact_contestation stays append-only

## Status
Accepted. Resolves QUESTIONS.md #10. Adjusts the classification migration 0017 applied; clarifies CLAUDE.md hard rule 3.

## Context
Two governing documents disagreed about two tables:

- **CLAUDE.md hard rule 3** listed `migration_job` and `fact_contestation` among the strictly *insert-only* (append-only) tables.
- **ARCHITECTURE.md** (Layer 2) describes `migration_job` as having a **"status lifecycle"** (pending → running → completed/failed/reversed, with a reversal plan).

When the core substrate was built, the conflict was resolved conservatively in favor of the hard rule: migration 0017 enrolled both tables in append-only enforcement (REVOKE UPDATE/DELETE + a `zzz_append_only` trigger), and `migration_job` carried `job_group_id` + `supersedes_id` so a "status change" was a *new row* superseding the prior one, with the current state being the head of the chain.

That works, but it fights the grain of what a migration job *is*. A migration job is an **operational process**, not a fact about the world. The substrate already has a precedent for exactly this shape: `worker_job` (migration 0013) — an in-place-mutable, tenant-scoped operational record whose history is the stream of events its transitions emit. Modeling `migration_job` as an append-only supersession chain duplicates that machinery awkwardly and makes "what is the current status" a chain-walk instead of a column read.

`fact_contestation` is the opposite case. A contestation is a *fact about the data* ("these two facts conflict"), and its resolution is itself a fact. Editing a contestation row in place would erase the history of how a conflict was adjudicated — precisely the auditability the substrate exists to provide. Its resolutions are already modeled as new linked records (`contestation_group_id` + `supersedes_id`).

## Decision
**`migration_job` is a lifecycle table.** Its `status` mutates in place over the job's life. Each transition **must emit an event** — the event stream is the audit trail, exactly as for `worker_job`. Concretely (migration 0021):

- the `zzz_append_only` trigger is removed from `migration_job`;
- the deny-UPDATE RLS policy is replaced with a tenant-scoped UPDATE policy; UPDATE is re-granted to `authenticated`/`service_role` (never `anon`);
- DELETE/TRUNCATE remain revoked — a job ends in a terminal status, it is never hard-deleted;
- the now-obsolete `job_group_id` and `supersedes_id` columns are dropped.

**`fact_contestation` stays append-only.** No change. Resolutions are new linked records via `contestation_group_id`/`supersedes_id`, never edits.

CLAUDE.md hard rule 3 is updated to drop `migration_job` from the insert-only list (and to note that lifecycle/operational tables — `worker_job`, `migration_job` — are audited via the events their transitions emit).

## Consequences

**Easier**
- "Current status of a migration job" is a column read, not a chain-walk.
- `migration_job` and `worker_job` share one mental model and one enforcement shape (tenant-scoped, UPDATE allowed, no hard delete, evented transitions).

**Harder / obligations**
- A future `migration_job` handler **must** record an event on every status transition. The append-only row history no longer provides the audit trail; the events do. Until that handler exists, `migration_job` is unused scaffolding (0 rows) and the obligation is documented here and in the table comment.

**Guardrail unchanged**
- This does not loosen append-only anywhere a *fact* is recorded. Event, action, attribute history, contestations, identity assertions, configuration changes, etc. remain append-only/bitemporal. Only the two *operational job* tables are mutable-by-design.

## Alternatives considered
- **Keep migration_job append-only (status as supersession chain).** Rejected: fights the grain, duplicates worker_job awkwardly, makes current-status a chain-walk, and contradicts ARCHITECTURE.md's "status lifecycle" wording.
- **Make fact_contestation lifecycle too (symmetry).** Rejected: a contestation and its resolution are *facts*; editing them in place destroys adjudication history — the exact auditability the substrate guarantees.

## Pointers
- Migration `0021_migration_job_lifecycle.sql` (reverses `0017` for migration_job); `0013_worker_job_queue.sql` (the lifecycle precedent).
- ARCHITECTURE.md Layer 2 ("Migration job … status lifecycle"); CLAUDE.md hard rule 3.
- QUESTIONS.md #10.
