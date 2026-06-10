# Exsto Skill Library — Authoring Standard & Manifest

The skills that ship in the Exsto foundation template. Every project cloned from the foundation inherits this library, so quality here compounds across every tool built on the substrate. This document is the **source of truth**: the roster, the authoring standard, and the tier definitions. `.claude/skills/MANIFEST.md` is the lightweight in-repo index; this document governs it.

## How this is used

- **Humans / Claude:** read this to know what skills exist, what each is bound to, and how to write or change one.
- **`/build-skills`** (`.claude/commands/build-skills.md`): reads this file, audits `.claude/skills/` against the roster, grounds each skill against the real repo, tests each against the live DB / invariant suite, authors anything missing, and reports. Adding a skill is: drop a draft → run `/build-skills` → review → PR.

## Cardinal rule

**A skill's claims are confirmed against the live database, the invariant suite, or the actual code — never asserted from assumption.** Every skill ends with a concrete **Verify** check. This is root `CLAUDE.md` hard rule 12 ("verify on the database"); it is what makes the library trustworthy enough to ship in every clone.

## Authoring standard — the anatomy every skill follows

Gold-standard reference: **`exsto-query-substrate`**. Every skill has, in order:

1. **Frontmatter** — `name` + `description`. The description leads with *what* it governs, then `ALWAYS consult this when …` triggering conditions; keyword-rich (real error strings, table names, tools), never a summary of the skill's own workflow.
2. **Principle** — one paragraph: the invariant and the stakes (why getting this wrong breaks a guarantee the product rests on).
3. **The rule / what every X must do** — the core constraint, concrete and imperative.
4. **Real shapes & ground-truth pointers** — actual helper names, signatures, file paths, tables, triggers, commands — verified against the repo. **No placeholders** ("match the existing…"), no invented helpers.
5. **Gotchas / anti-patterns** — the specific ways people get it wrong.
6. **Pointers to ground truth** — files, ADRs, sibling skills.
7. **Verify** — a runnable SQL/command that proves the claim against the live DB, the invariant suite (`tests/invariants/`), or the code.

**Grounding rule.** When grounding an existing skill, fix the *pointers* to match reality; **do not change the encoded principle.** A skill is "grounded" when every helper/path/signature/table/trigger/command in it is real and current, and "tested" when its Verify check has actually run against reality.

**Naming.** Substrate/reference/workflow skills use `exsto-<thing>`. Two user-facing command skills keep a short bare name — `newplatform`, `starterprompt` — so `/newplatform` and `/starterprompt` read cleanly as commands.

## Tiers

- **Tier 1 — Substrate (crown jewels).** Hand-written, grounded in real migrations / primitives / tools / the action core. Shipped in every clone. These encode the invariants and the one operation core.
- **Meta / lifecycle.** Stand up and shape new platforms on the foundation.
- **Tier 2 — Reference.** Tight wrappers around the external tools every Exsto project uses (Supabase, Next.js, the MCP server runtime) — our specific way of using them.
- **Tier 3 — Workflow.** Borrowed disciplines (Superpowers, review, worktrees), adapted to the substrate. Used sparingly; do not bulk-install catalogs.

## The roster (15 skills)

### Tier 1 — Substrate

| Skill | Purpose | Grounded against (verified anchors) |
| --- | --- | --- |
| `exsto-substrate-migration` | Invariant-safe schema changes: RLS + append-only/bitemporal triggers, anon lockdown, forward-only, self-recorded. | `sync_migration_history()`; `zzz_append_only`/`substrate_block_write` (0017); `zzz_no_delete`/`zzz_seal_guard`/`substrate_block_delete`/`substrate_seal_guard` (0018); anon lockdown (0019); migration `0001` RLS shapes. |
| `exsto-add-kind` | New domain concepts are definition **rows**, never tables/enums (schema-as-data). | Registries `entity_kind_definition`/`attribute_kind_definition`/`relationship_kind_definition`/`event|judgment|outcome_kind_definition`/`action_kind_definition`; tool `substrate.kind.define`; seed `0001_initial_data.sql`. |
| `exsto-mcp-tool` | MCP tools are thin dispatch over primitives — the **primary adapter** over the one operation core. | `registerTool`/`getTools`/`Tool` (`packages/mcp-tools/src/tool.ts`); `substrateTools.ts` (22 generic tools); `mode: 'read'|'write'`. |
| `exsto-rest-api` | Expose Exsto over REST/OpenAPI — **only** as a sibling adapter over the same core, never a parallel CRUD layer. | ADR 0038; `submitAction`/`executeQuery`/`withActionContext`; primitive facades + `queries.ts`; `apps/mcp-server` as the sibling to mirror. |
| `exsto-new-vertical` | Build a new product/vertical on the foundation without touching the substrate. | `verticals/legal/` reference; ADRs 0029/0030/0032/0034; additive-only rule. |
| `exsto-verify-tenancy` | Prove tenant isolation + append-only + bitemporal protection on a live DB. | `tests/invariants/{rls-enforcement,append-only,bitemporal}.test.ts`; `SUBSTRATE_TEST_DATABASE_URL`; `SET LOCAL ROLE authenticated`; the `zzz_*` triggers. |
| `exsto-query-substrate` | Bitemporal reads done right (current / as-of / history); carry knowability, confidence, provenance, polarity. **(gold standard)** | `executeQuery` (`@exsto/substrate`); `queries.ts` helpers (`getCurrentAttributes`, `getAttributeHistory`, …); `valid_from`/`valid_to`. |
| `exsto-ai-operation` | AI actions record a linked reasoning trace and write only through the action layer; honest confidence + autonomy tier. | `reasoning_trace` (mig 0004); `submitAction` trace enforcement; `callClaudeDrafter` + `LEGAL_DRAFTING_MODEL` (`adapters/claude.ts`); `generateDraft.ts` local `persistReasoningTrace`; `reasoning.capture`. |
| `exsto-bootstrap-tenant` | Correct, idempotent order to create a tenant (tenant → actor → kinds) so no half-formed tenants. | Seed UUID scheme (tenant `…0001`, actors `…0001-…00N`, agent `…004`); mig `0001` (tenant/actor/action_kind_definition/action). |

### Meta / lifecycle

| Skill | Purpose | Grounded against |
| --- | --- | --- |
| `newplatform` | `/newplatform` — clone the template repo + replay migrations onto a fresh DB; reproduce the substrate without rebuilding. | `github.com/Jogotsoftware/exsto` template; `supabase/migrations/` + `supabase/seed/`; Supabase MCP `create_project`/`apply_migration`; exsto-bootstrap-tenant + exsto-verify-tenancy. |
| `starterprompt` | `/starterprompt` — turn a rough idea into one tight, substrate-aware Claude Code starter prompt. | The exsto-* skill set; kinds → MCP tools → AI ops mapping. |

### Tier 2 — Reference

| Skill | Purpose | Grounded against |
| --- | --- | --- |
| `exsto-supabase` | Supabase/Postgres **is** the substrate (ADR 0026): forward-only migrations, RLS everywhere, apply via MCP, never bypass with `service_role`. | Project refs `exsto-dev` (`vjpqtzxtxhisbuaerfbb`) / `exsto-wedge`; `get_advisors`; `schema_migration`; ADR 0037 role model. |
| `exsto-mcp-spec` | The MCP server runtime (transport, dispatch, per-request tenant context) and its relation to the MCP standard. | `apps/mcp-server/src/{index,mcp}.ts` (bespoke HTTP: `GET /health`, `GET /tools`, `POST /mcp` on `:4000`; no stdio/JSON-RPC yet); `getTools()`. |
| `exsto-nextjs` | Next.js apps as presentation over the core: call an adapter (never the DB), render substrate metadata, Supabase Auth + tenant binding. | `apps/legal-demo` (real app, ADR 0036); `docs/patterns/reference-app-surface.md`; ADR 0035. |

### Tier 3 — Workflow

| Skill | Purpose | Grounded against |
| --- | --- | --- |
| `exsto-workflow` | The Exsto build rhythm + which installed discipline to use, with the non-negotiable verify-on-DB gate. | Root `CLAUDE.md` rules; installed Superpowers skills; `invariant-auditor` subagent; `exsto-verify-tenancy`. |

## The one operation core (architecture note)

MCP and REST are **sibling adapters over one operation core** — the action/query layer (`packages/substrate` `submitAction`/`executeQuery` + the `packages/primitives` facades) — not two doors to the database (ADR 0024 amended by ADR 0038). Any skill that touches an interface (`exsto-mcp-tool`, `exsto-mcp-spec`, `exsto-rest-api`, `exsto-new-vertical`, `exsto-nextjs`, `starterprompt`) states this the same way: clients reach the substrate only through an adapter, and an adapter never runs its own substrate SQL.

## Promotion path

When a skill proves useful in a project built on the foundation, promote it *up* into this template so every future project inherits it. That is how the library compounds without bloating. Record the addition here and in `.claude/skills/MANIFEST.md`, then run `/build-skills`.

## Always-on rules

Four rules are too important to load only sometimes; they live in root `CLAUDE.md` as non-negotiables, with these skills carrying the depth: **schema-as-data**, **one operation core** (MCP + REST adapters, never direct substrate access), **append-only history**, and **verify on the database**.
