# Invariant tests

Each of the 23 Layer 1 invariants (ARCHITECTURE.md) is enforced structurally in
the schema and/or the action layer, and checked here. Tests come in two tiers:

- **Unit** (no DB): run everywhere, including CI without credentials.
- **DB-gated** (live Postgres): run only when `SUBSTRATE_TEST_DATABASE_URL` (or
  `DATABASE_URL`) points at a seeded substrate. Otherwise `describe.skipIf` skips
  them. Point them at the `exsto-dev` project (the clean substrate DB).

Run: `pnpm test`. With a DB: `SUBSTRATE_TEST_DATABASE_URL=... pnpm test`.

> Note on RLS enforcement: tenancy + append-only policies bind for **non-owner**
> roles. The app/worker must connect as a non-owner role for RLS to be active;
> the table *owner* bypasses RLS (Postgres default). The structural tests assert
> the policies are configured (role-independent); a full RLS-enforcement test
> requires connecting as a non-owner role. Whether to add `FORCE ROW LEVEL
> SECURITY` is an open decision for the founder (see QUESTIONS.md).

## Invariant → enforcement → test

| # | Invariant | Enforced by | Test |
|---|-----------|-------------|------|
| 1 | Tenancy / RLS | `tenant_id` + RLS policies on every table | `schema-invariants` (RLS enabled; tenant_id present) |
| 2 | Temporality | `valid_from`/`valid_to`; `attribute.set` closes prior | `roundtrip` (supersession) |
| 3 | Time precision | `*_precision` CHECK enums | `schema-invariants` (cols), `roundtrip` |
| 4 | Stable identity | `identity_assertion` (append-only, supersedes_id) | `schema-invariants` (append-only set) |
| 5 | Provenance | `source_type` NOT NULL on facts | `schema-invariants` |
| 6 | Confidence | `confidence` NOT NULL + CHECK [0,1] | `schema-invariants` |
| 7 | Knowability | `knowability_state` NOT NULL + CHECK | `schema-invariants` |
| 8 | Assertion polarity | `polarity` columns | `schema-invariants` (attribute/judgment) |
| 9 | Auditability | every write is an `action`; handlers run in its txn | `roundtrip`, `schema-invariants` (action NOT NULLs) |
| 10 | Intent | `action.intent_kind` NOT NULL + CHECK | `schema-invariants` |
| 11 | Reversibility | `action_kind_definition.reversibility` + reverse kind | seed; (engine WIP) |
| 12 | Schema-as-data | definition registries; `getCapabilities` | `roundtrip` (capabilities) |
| 13 | Projection determinism | `raw_event_log` + deterministic projection | (worker projection WIP) |
| 14 | Append-only events | deny UPDATE/DELETE policies | `schema-invariants` |
| 15 | Hybrid logical clocks | `nextHlc()` monotonic; HLC cols on logs | `hlc` (unit) |
| 16 | Read consistency | reads run in the action context txn | `roundtrip` (read-your-writes) |
| 17 | Config version binding | `*_definition` versioned; `workflow_instance` binds | schema (WIP engine) |
| 18 | Cryptographic chains | `content_hash`/`previous_hash` cols (per-tenant, off) | schema present |
| 19 | Causality graph | `causal_claim` | `schema-invariants` (append-only) |
| 20 | Reasoning capture | `reasoning_trace`; judgment links | schema present |
| 21 | Contestation | `fact_contestation` (append-only, group/supersede) | `schema-invariants` |
| 22 | Governance gradients | `autonomy_tier` on action + action_kind default | `schema-invariants` |
| 23 | Extensibility | new kinds = definition rows, no code | `roundtrip` (capabilities) |

Plus: worker retry/backoff — `worker-backoff` (unit).

## Still to deepen (follow-on)

A full non-owner-role RLS enforcement test, projection-determinism replay test
(invariant 13), config-version-binding test (17), and hash-chain computation +
verification test (18) once those engine pieces land.
