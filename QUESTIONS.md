# Open questions

Each section: the decision, the tradeoffs, the recommendation, what was done. Listed in order of importance for the next session.

## 1. Move substrate work from this fork to upstream `Jogotsoftware/exsto`?

The branch was built directly on the Jogotsoftware/exsto clone because the GH identity owns the upstream repo and forking to itself is impossible. The substrate engine pieces (`packages/substrate`, the migration changes to 0003/0004/0005, the primitives handlers, the MCP tool registry pattern) are tenant-agnostic and could land upstream. The legal vertical (`verticals/legal`, `apps/legal-*`) is customer-specific and should not.

Recommendation: cherry-pick or rebase substrate-only changes onto an `upstream-substrate-v1` branch, open a PR against the upstream main, and leave the legal vertical on `substrate-and-legal-wedge` only.

Proceeded with: deferred — all changes live on `substrate-and-legal-wedge` for the founder's review.

## 2. Apply migrations 0002–0005 to the existing `exsto-dev` project, or treat `exsto-wedge` as canonical?

This session created a fresh Supabase project **exsto-wedge** (`qlqkpuyhppfodmpeybcz`, free tier, us-east-1) and applied all five migrations + the seed there. `exsto-dev` remains paused with only migration 0001 applied. Going forward, either:

- Keep `exsto-wedge` as the canonical dev DB, retire `exsto-dev`. Migration history starts clean on the new project.
- Restore `exsto-dev` and apply 0002–0005 there as well, keeping it as the substrate-development environment and `exsto-wedge` as the Pacheco Law-specific one.

Recommendation: use `exsto-wedge` as the canonical dev DB for this branch; restore `exsto-dev` only if you want a separate substrate-only sandbox before merging upstream.

Proceeded with: `exsto-wedge` is where the schema lives. Founder picks the long-term home.

## 3. RLS for the public client portal — what actor signs writes?

The client portal proxies through Next.js `/api/mcp` with a fixed `public-intake` system actor (`00000000-0000-0000-0000-000000000004`). All matter creations + questionnaire submissions from the unauthenticated portal carry that actor as the auditable origin. The client's identity is captured in `client_contact` entity attributes (full name, email) but not in the action's actor_id.

This is correct under the architecture (the action's actor is "who performed the action in our system", which is the public intake form, not the as-yet-unauthenticated prospective client). But it means the audit log doesn't directly attribute writes to a person. The `client_contact` linkage to the matter is the breadcrumb.

Decision needed: confirm `public-intake` system actor for v1 is fine; if not, what does an unauthenticated client actor look like and how is it created on first submission?

Proceeded with: `public-intake` system actor.

## 4. Drafting model identity

`verticals/legal/src/lib/modelRouter.ts` (the central model router, `TIER_MODEL`/`resolveModelForTask`) defaults server drafting tasks to `claude-sonnet-4-6`, overridable per-deploy via `LEGAL_DRAFTING_MODEL`. The drafting prompt and reasoning trace structure are stable across the Claude 4.x family, but the founder should pick the production model deliberately. Options: Sonnet 4.6 (default), Opus 4.8 (higher quality, more expensive), Haiku 4.5 (cheaper, lower quality — already the router's default for cheap/high-volume tasks like key verification and ordinary transcript/service-digest extraction).

Recommendation: Sonnet 4.6 for the v1 evaluation; Opus 4.7 once you want to assess top-quality drafts.

Proceeded with: Sonnet 4.6, env-overridable.

## 5. Worker runtime vs. inline drafting

Per ADR 0027, worker runtime is supposed to be from day one. For the wedge MVP, the drafting Claude call runs inline in `generateDraft` — the MCP request waits for the model response (often 30+ seconds). Better would be a pgmq job triggered by the action, with the attorney UI polling for completion.

Decision needed: when does the worker path land? Suggest after the first real Pacheco Law matter has gone through inline drafting successfully.

Proceeded with: inline. Worker runtime kept as scaffold for later.

## 6. Hash-chain on action + raw_event_log

Both tables have `previous_hash bytea` columns, both are unused. ADR 0018 requires the chain; v1 ships without computation. For the wedge demo it's fine, but the moment we represent any compliance posture to a client, this needs to be on.

Recommendation: implement before any client-shareable claim of "tamper-evident substrate". A focused later session.

Proceeded with: deferred, columns reserved.

## 7. Invariant test scaffolding

`tests/invariants/` is an empty directory with a README. The 23 invariants have ADRs (0001–0023) but no executable tests. Recommendation: dedicate a follow-on session to one test file per invariant, each writing through the action layer and asserting the invariant under both happy-path and adversarial conditions. This is what makes the substrate auditable.

Proceeded with: deferred.

## 8. The `attribute_kind_definition` policy name collision

Migrations 0001 and 0002 both define policies named `akd_tenant_isolation_*`, on different tables. Postgres scopes policy names per table so it works. To keep `0002_definition_registries.sql` distinct and self-evident, the applied SQL on `exsto-wedge` renamed the second set to `akd2_*`. The migration file in the repo still says `akd_*`. Either is correct; the repo and applied state are slightly out of sync on this cosmetic detail.

Recommendation: edit the repo migration to `akd2_*` or accept the difference. Will resolve itself if the founder re-applies via `supabase db reset`.

---

# Core substrate (Layer 0-2) build — open decisions (2026-06-03)

The clean substrate now lives on branch `core-substrate` and Supabase project
`exsto-dev` (separate from the law tool on `main` + `exsto-wedge`). New open
decisions from completing the Layer 2 schema, engine, worker, and tests:

## 9. RLS enforcement model: owner-bypass vs FORCE ROW LEVEL SECURITY

Every table has tenant-isolation + append-only RLS policies, but Postgres
**table owners bypass RLS by default**. So tenancy (invariant 1) and append-only
(invariant 14) are enforced only when the app/worker connect as a **non-owner**
role. If the connection string uses the `postgres`/owner role, RLS is silent and
the guarantees rest on the application always tenant-scoping its SQL (which the
substrate does via `withTenant`).

Options: (a) ensure the app connects via a dedicated non-owner role with RLS
active; (b) add `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so even the owner is
subject to RLS — but then the seed/migrations and the worker's cross-tenant
claim must run as a BYPASSRLS/superuser role or be reworked.

Recommendation: (a) for app/worker connections now; consider (b) before any
external/regulated deployment. Proceeded with: policies in place; enforcement
role choice deferred to the founder. The invariant tests assert the policies are
*configured*; a non-owner-role enforcement test is the follow-on.

**RESOLVED — ADR 0037 (RLS role model).** Decision: option (a). Apps/adapters
(MCP server, REST adapter, Next routes) connect as the non-owner, non-BYPASSRLS
`authenticated` role, so RLS is enforced by the database; migrations/seed run as
owner; the worker connects privileged for the cross-tenant *claim* only, then
binds `app.tenant_id` per job. We do NOT enable FORCE ROW LEVEL SECURITY now (it
would break the owner-run seed and the worker claim for defense-in-depth the role
discipline already provides; revisit before any regulated deployment). The
append-only/bitemporal TRIGGERS (0017/0018) fire for *every* role incl. BYPASSRLS,
so invariant 14 holds even for the privileged paths. `rls-enforcement.test.ts`
guards against an accidental owner-role switch.

## 10. Append-only vs status-lifecycle for migration_job and fact_contestation

CLAUDE.md hard rule 3 lists both as insert-only, but ARCHITECTURE.md describes
them as having a status lifecycle. I honored the hard rule: both are append-only
with a `*_group_id` + `supersedes_id` chain, so a status change is a new row that
supersedes the prior; "current" status is the chain head.

Decision needed: keep append-only (matches hard rule 3, more auditable, slightly
more query work) or make them directly mutable (matches the architecture prose).

**DECIDED 2026-06-04 (ADR 0039):** split the two.
- `migration_job` → **lifecycle table.** It is an operational process, not a fact;
  `worker_job` is the existing precedent. status mutates in place; each transition
  emits an event (the audit trail). Migration 0021 drops the append-only trigger,
  swaps to a tenant-scoped UPDATE policy, re-grants UPDATE to app roles (DELETE stays
  revoked), and drops the now-obsolete `job_group_id`/`supersedes_id` columns.
  CLAUDE.md hard rule 3 updated to drop migration_job.
- `fact_contestation` → **stays append-only.** A contestation and its resolution are
  facts; editing them in place would erase adjudication history. Resolutions remain
  new linked records (`contestation_group_id`/`supersedes_id`). Unchanged.

## 11. Registry naming: `attribute_kind_definition` vs DoD's `attribute_definition`

The DoD shorthand calls it `attribute_definition`; the built substrate uses
`attribute_kind_definition` (consistent with entity/relationship/event/judgment/
outcome/period `*_kind_definition`). Kept the existing `*_kind_definition`
naming for consistency. Cosmetic; flag only if the DoD wording is binding.

**RESOLVED — ADR 0040.** Keep `attribute_kind_definition`. `<concept>_kind_definition`
is the canonical naming convention for all eight kind/definition registries and
every clone/vertical inherits it; consistency beats matching one prose sentence,
and it is already canonical in the built system + live DB. ARCHITECTURE.md's
`attribute_definition` prose reads as shorthand for the `attribute_kind_definition`
table. No schema change. New registries follow the same pattern.

## 12. Legal vertical decoupled from the shared mcp-tools package

(This is the "legal welded into `mcp-tools`" template-readiness blocker, approved
for fix this session. It is distinct from #5 above, which is about worker-runtime
vs inline drafting and remains open.)

`@exsto/mcp-tools` depended on `@exsto/legal`, so the generic adapter could not be
cloned without the legal vertical. **RESOLVED 2026-06-04:** dependency inverted.
The 19 legal tool files moved to `verticals/legal/src/mcp/`; `@exsto/mcp-tools`
now registers only the generic substrate tools and has no vertical dependency;
`@exsto/legal` depends on `@exsto/mcp-tools` and exposes `@exsto/legal/mcp`, which
a consumer side-effect-imports to opt the legal tools into the shared registry.
Generic surface = 22 tools (0 legal); legal surface adds 47. No legal code
deleted. See the decouple commit + CLAUDE.md in `packages/mcp-tools`.
