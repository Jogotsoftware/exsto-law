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
| [exsto-external-api](exsto-external-api/SKILL.md) | Consume external services: raw_event_log first, worker-run idempotent projection, verified signatures, server-side tenant resolution, secrets in Vault. Grounded in the exsto-law Granola/Google reference implementations. |
| [exsto-public-surface](exsto-public-surface/SKILL.md) | Secure a clone's unauthenticated edges (public MCP/REST routes, booking/intake forms, shared-link pages, OAuth callbacks): default-deny tool allowlist, rate-limit public writes, validate post-auth redirects same-origin, sign OAuth state, redact secrets. Grounded in three real holes found + fixed in the legal clone. |

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

### Engineering discipline (vendored from [obra/superpowers](https://github.com/obra/superpowers))

The borrowed disciplines `exsto-workflow` orchestrates. Cross-references were de-namespaced (`superpowers:` prefix stripped) so they resolve to these bare directory names. Pair every one of these with the verify-on-DB gate — none of them override Exsto's hard rules.

| Skill | Purpose |
| --- | --- |
| [brainstorming](brainstorming/SKILL.md) | Explore intent, requirements, and design **before** any creative/implementation work. |
| [writing-plans](writing-plans/SKILL.md) | Turn a spec into a multi-step implementation plan before touching code. |
| [executing-plans](executing-plans/SKILL.md) | Execute a written plan in a separate session with review checkpoints. |
| [subagent-driven-development](subagent-driven-development/SKILL.md) | Execute a plan's independent tasks via subagents in the current session. |
| [dispatching-parallel-agents](dispatching-parallel-agents/SKILL.md) | Fan out 2+ independent, no-shared-state tasks to parallel agents. |
| [test-driven-development](test-driven-development/SKILL.md) | RED-GREEN-REFACTOR before writing implementation code (mirrors the invariant-test discipline). |
| [systematic-debugging](systematic-debugging/SKILL.md) | Structured root-cause approach to any bug/test failure before proposing a fix. |
| [verification-before-completion](verification-before-completion/SKILL.md) | Run verification + confirm output before claiming done — the discipline behind hard rule #12. |
| [requesting-code-review](requesting-code-review/SKILL.md) | Code-review template before merging major work. |
| [receiving-code-review](receiving-code-review/SKILL.md) | Handle review feedback with technical rigor — verify, don't blindly implement. |
| [finishing-a-development-branch](finishing-a-development-branch/SKILL.md) | Structured options for merge / PR / cleanup once work is complete. |
| [using-git-worktrees](using-git-worktrees/SKILL.md) | Ensure an isolated workspace exists (native or git worktree) before feature work. |
| [writing-skills](writing-skills/SKILL.md) | Create/edit/verify skills (TDD-for-docs) — the meta-skill for maintaining this very library. |

## Tier 2 — Document & app-testing tooling (vendored from [anthropics/skills](https://github.com/anthropics/skills))

General-purpose deliverable tooling that serves the legal vertical directly (documents, invoice PDFs, billing exports, UI verification). Each carries its own scripts/reference assets.

| Skill | Purpose |
| --- | --- |
| [docx](docx/SKILL.md) | Create/read/edit Word documents — tracked changes, templates, letterheads, find-and-replace. Legal deliverables. |
| [pdf](pdf/SKILL.md) | Read/extract/merge/split/fill/OCR PDFs and produce them. Invoice + document output. |
| [xlsx](xlsx/SKILL.md) | Create/read/edit spreadsheets — formulas, charts, clean messy tabular data. Billing exports. |
| [webapp-testing](webapp-testing/SKILL.md) | Drive a local web app with Playwright to verify UI, capture screenshots + browser logs. Verify the Next.js app. |

## Promotion path

When a skill proves useful in a project built on the foundation, promote it *up* into this template so every future project inherits it. That is how the library compounds without bloating.

## Always-on rules

Four rules are too important to load only sometimes; they live in the root `CLAUDE.md` as non-negotiables, with these skills carrying the depth: schema-as-data, MCP-only, append-only history, and **verify on the database**.
