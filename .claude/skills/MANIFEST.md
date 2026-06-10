# Exsto Skill Library — Manifest

The skills that ship in the Exsto foundation template. Every project cloned from the foundation inherits this library, so quality here compounds across every tool built on the substrate. Authoring standard, tier definitions, and the gold-standard anatomy are governed by the *[Exsto Skill Library — Authoring Standard & Manifest](../../docs/EXSTO_SKILL_LIBRARY.md)*.

**Cardinal rule:** a skill's claims are confirmed against the live database / invariant suite / actual code — never asserted from assumption. Each skill ends with a concrete **Verify** section.

## Tier 1 — Substrate skills (the crown jewels)

Hand-written, grounded in real migrations/primitives/tools, shipped in every clone.

| Skill | Purpose |
| --- | --- |
| [exsto-substrate-migration](exsto-substrate-migration/SKILL.md) | Invariant-safe schema changes: RLS + append-only/bitemporal triggers, anon lockdown, forward-only, self-recorded via `sync_migration_history()`. |
| [exsto-add-kind](exsto-add-kind/SKILL.md) | New domain concepts are definition **rows**, never new tables or enums (schema-as-data). |
| [exsto-mcp-tool](exsto-mcp-tool/SKILL.md) | MCP is the only client interface; tools are thin dispatch (`registerTool` + `mode`) over primitives, never direct DB writes. |
| [exsto-new-vertical](exsto-new-vertical/SKILL.md) | Build a new product/vertical on the foundation without touching the substrate. |
| [exsto-verify-tenancy](exsto-verify-tenancy/SKILL.md) | Prove tenant isolation + append-only + bitemporal protection on a live DB (RLS tests + audit queries). |
| [exsto-query-substrate](exsto-query-substrate/SKILL.md) | Bitemporal reads done right (current / as-of / history); knowability, confidence, provenance, polarity; read as `authenticated`. **(gold-standard reference)** |
| [exsto-ai-operation](exsto-ai-operation/SKILL.md) | AI actions record a linked reasoning trace and write only through the action layer; honest confidence + autonomy tier. |
| [exsto-bootstrap-tenant](exsto-bootstrap-tenant/SKILL.md) | Correct, idempotent order to create a tenant (tenant → actor → kinds) so no half-formed tenants. |

## Meta / lifecycle skills

Stand up and shape new platforms on the foundation.

| Skill | Purpose |
| --- | --- |
| [newplatform](newplatform/SKILL.md) | `/newplatform` — clone the template repo + replay migrations onto a fresh DB; reproduce the substrate without rebuilding. |
| [starterprompt](starterprompt/SKILL.md) | `/starterprompt` — turn a rough idea into one tight, substrate-aware Claude Code starter prompt. |

## Tier 2 — Reference skills

Tight wrappers around the external tools every Exsto project uses — our specific way of using them.

| Skill | Purpose |
| --- | --- |
| [exsto-supabase](exsto-supabase/SKILL.md) | Supabase/Postgres as the substrate DB: forward-only migrations, RLS everywhere, apply via MCP, never bypass with `service_role`. |
| [exsto-mcp-spec](exsto-mcp-spec/SKILL.md) | The MCP server runtime (transports, dispatch, per-request tenant context) and its relation to the Model Context Protocol. |
| [exsto-nextjs](exsto-nextjs/SKILL.md) | Next.js apps as presentation over MCP: call the server (never the DB), render substrate metadata, Supabase Auth + tenant binding. |

## Tier 3 — Workflow skills

Borrowed sparingly, adapted to the substrate. Do not bulk-install catalogs.

| Skill | Purpose |
| --- | --- |
| [exsto-workflow](exsto-workflow/SKILL.md) | The Exsto build rhythm + which installed discipline (Superpowers/review/worktrees) to use, with the non-negotiable verify-on-DB gate. |

## Promotion path

When a skill proves useful in a project built on the foundation, promote it *up* into this template so every future project inherits it. That is how the library compounds without bloating.

## Always-on rules

Four rules are too important to load only sometimes; they live in the root `CLAUDE.md` as non-negotiables, with these skills carrying the depth: schema-as-data, MCP-only, append-only history, and **verify on the database**.
