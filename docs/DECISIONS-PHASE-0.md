# Phase 0 — Judgment Calls & Decisions Log

Running log of non-obvious calls made during the autonomous Phase 0 build, per the
build directive's autonomy protocol. Each entry: what, why, where it lands.

## Stage 1 — Clone the foundation

1. **Template generated from foundation `main` HEAD (`2673218`), not the `v1.0.0` tag commit (`cd77ebf`).**
   GitHub template generation always uses the default branch HEAD. Verified delta:
   exactly one docs-only commit (`docs/FOUNDATION_CERTIFICATION.md` status block, +39
   lines) — which the launch guide lists as a prerequisite anyway. Substrate content
   is identical to v1.0.0. Stamped `FOUNDATION_COMMIT=2673218…`, version `1.0.0`.

2. **DB credential via Management API password reset (founder-approved).**
   Supabase forbids `ALTER ROLE postgres` via SQL ("only superusers"). Founder
   approved one-time use of an existing account PAT to set the exsto-law DB password.
   The credential lives only in `.env.local` (gitignored). No PAT stored in this repo.

3. **"Advisors 0" gate = security advisors (the certification's measure).**
   Security advisors: 0 lints. Performance advisors return schema-inherent lints
   (167× `auth_rls_initplan` WARN from core RLS policy shape; `unused_index` /
   `unindexed_foreign_keys` INFO expected on a zero-history fresh DB). The schema is
   migration-identical to the certified foundation, so these exist on the reference
   instance too. Core migrations are out of bounds for this build → queued as a
   foundation-upgrade observation (wrap auth functions in scalar subqueries), not fixed here.

4. **`anon` write grants exist only in the `storage` schema (Supabase platform baseline).**
   `public` (substrate) anon write grants = 0, matching certification. Storage tables
   have RLS enabled with zero policies (deny-by-default). No action needed.

5. **Final migration ledger row required one explicit `sync_migration_history()` call.**
   Each migration's sync call runs before the CLI records that migration's own row, so
   migration 0026 lagged by design. One post-push sync trued the ledger to 26 = 26.

## Stage 2 — Lock the repo

6. **Branch protection is plan-gated; proceeding unenforced (founder-approved, $0).**
   GitHub Free (org private repos) blocks both branch-protection API and rulesets
   (HTTP 403 "Upgrade to GitHub Pro"). Founder chose to proceed with PR-only
   discipline (session safety layer already hard-blocks pushes to main; founder is
   the only other writer). Money question queued in the phase report: GitHub Team
   (~$4/user/mo) enables enforcement; the exact API call is in the report. NOTE: the
   foundation repo's main has the same gap.

7. **Setup work ships as its own PR → 9 PRs total (1 setup + 8 WPs), stacked.**
   With main PR-only from the start (and unmerged until founder review), each WP
   branch is based on the previous PR's branch. PR descriptions name their base.

## Stage 3 — Build

8. **Tenant zero**: the generic seed creates tenant `…0001` ("Exsto Dev"). WP1
   reconfigures it as Pacheco Law per `exsto-bootstrap-tenant` rather than creating a
   second tenant, keeping the fixed-UUID bindings (`LEGAL_CLIENT_TENANT_ID`) intact.
   (Confirmed pattern at WP1 time.)

9. **No `ANTHROPIC_API_KEY` found in this environment's related env files.** WP4
   (drafting) requires one. Queued to request from the founder at the next legitimate
   stop; drafting is built and tested behind the worker interface either way.

## WP1 (PR #2)

10. **Service kinds = `workflow_definition` rows.** Route (auto/manual) + intake form
    binding live in `transitions` jsonb; states = matter lifecycle. Zero new tables;
    Phase 1's library layer evolves these as config. Seed anchors them to an honest
    `system.bootstrap` action row (`workflow_definition.action_id` is NOT NULL).
11. **Google OAuth client creds pulled from wedge Netlify env (founder-approved).**
    Secret came back 20 chars (possibly scope-masked) — proven or disproven by the
    WP2 connect round-trip. No Anthropic/Granola keys existed on that site.
12. **Directive's skills map names `exsto-external-api`, which doesn't exist in the
    skill library.** Closest guidance: `exsto-rest-api` (exposing REST) + ingestion
    patterns in docs/patterns + ADRs (raw_event_log, projection workers). Flagged for
    the phase report.

## WP2 design plan (continuity note — written before building)

- **Wedge-era vertical code in this template references tables that don't exist on
  the certified clone** (`service_definition`, `document_template`,
  `service_document_template`, `google_oauth`, `integration_credential`) and stores
  tokens plaintext (violates REQ-SEC-01). WP2 replaces:
  - services → read from `workflow_definition` service kinds + repo-file intake forms
    (Lesson #3: templates-as-repo-files OK in Phase 0, loader stays library-ready)
  - credential storage → Supabase **Vault** (`vault.create_secret` / rotated by name
    `legal/<provider>/<tenant_id>`), plus one vertical TABLE
    `legal_integration_connection` for connection METADATA only (provider, status,
    account_email, scope, vault secret name, expiry) — RLS'd, no secret material.
    Classified as an operational lifecycle table (ADR 0039 analog).
- **Action vocabulary rewire:** intake flow = `intake.submit` (client_contact +
  questionnaire_response) → `matter.open` (matter) → `booking.create` (calendar event
  + schedule attrs), replacing the wedge's monolithic `legal.booking.submit`.
- **Double-booking guard:** `pg_advisory_xact_lock` on (tenant, slot) inside the
  booking handler + app-level overlap check. The wedge's unique index lived in a
  wedge-only migration; adding an index to the core `entity` table from a vertical
  migration would touch core namespace — rejected.
- **Attorney auth:** Supabase Auth Google SSO (REQ-AUTH-01); provider enablement is
  a dashboard step for the founder OR PAT-based config (offered; pending). Code path
  built regardless; public-intake actor handles the anonymous portal.
