# Exsto-Only Skills

`MANIFEST.md` documents the full skill library shipped in every Exsto clone, including
tooling borrowed from [obra/superpowers](https://github.com/obra/superpowers) and
[anthropics/skills](https://github.com/anthropics/skills). This file is the filtered
list: **only the skills that are Exsto's own IP** — the substrate rules, patterns, and
lifecycle commands specific to this platform. Everything else in `.claude/skills/` is
generic engineering discipline or vendored document/deploy tooling, not covered here.

## Substrate skills (Tier 1)

| Skill | Purpose |
| --- | --- |
| [exsto-substrate-migration](exsto-substrate-migration/SKILL.md) | Invariant-safe schema changes: RLS + append-only/bitemporal triggers, anon lockdown, forward-only, self-recorded via `sync_migration_history()`. |
| [exsto-add-kind](exsto-add-kind/SKILL.md) | New domain concepts are definition **rows**, never new tables or enums (schema-as-data). |
| [exsto-mcp-tool](exsto-mcp-tool/SKILL.md) | MCP is the only client interface; tools are thin dispatch (`registerTool` + `mode`) over primitives, never direct DB writes. |
| [exsto-new-vertical](exsto-new-vertical/SKILL.md) | Build a new product/vertical on the foundation without touching the substrate. |
| [exsto-verify-tenancy](exsto-verify-tenancy/SKILL.md) | Prove tenant isolation + append-only + bitemporal protection on a live DB (RLS tests + audit queries). |
| [exsto-query-substrate](exsto-query-substrate/SKILL.md) | Bitemporal reads done right (current / as-of / history); knowability, confidence, provenance, polarity; read as `authenticated`. |
| [exsto-ai-operation](exsto-ai-operation/SKILL.md) | AI actions record a linked reasoning trace and write only through the action layer; honest confidence + autonomy tier. |
| [exsto-bootstrap-tenant](exsto-bootstrap-tenant/SKILL.md) | Correct, idempotent order to create a tenant (tenant → actor → kinds) so no half-formed tenants. |
| [exsto-external-api](exsto-external-api/SKILL.md) | Consume external services: raw_event_log first, worker-run idempotent projection, verified signatures, server-side tenant resolution, secrets in Vault. |
| [exsto-public-surface](exsto-public-surface/SKILL.md) | Secure a clone's unauthenticated edges (public MCP/REST routes, booking/intake forms, shared-link pages, OAuth callbacks). |
| [exsto-rest-api](exsto-rest-api/SKILL.md) | Expose Exsto functionality as REST/OpenAPI — a thin sibling adapter over the same operation core as MCP, never a parallel CRUD layer (ADR 0038). |

## Meta / lifecycle skills

| Skill | Purpose |
| --- | --- |
| [newplatform](newplatform/SKILL.md) | `/newplatform` — clone the template repo + replay migrations onto a fresh DB. |
| [starterprompt](starterprompt/SKILL.md) | `/starterprompt` — turn a rough idea into one tight, substrate-aware Claude Code starter prompt. |
| [exsto-upgrade-foundation](exsto-upgrade-foundation/SKILL.md) | Upgrade an existing clone to a newer foundation version without clobbering its Layer-3 vertical. |

## Reference skills (Tier 2, Exsto-specific)

| Skill | Purpose |
| --- | --- |
| [exsto-supabase](exsto-supabase/SKILL.md) | Supabase/Postgres as the substrate DB: forward-only migrations, RLS everywhere, apply via MCP, never bypass with `service_role`. |
| [exsto-mcp-spec](exsto-mcp-spec/SKILL.md) | The MCP server runtime (transports, dispatch, per-request tenant context) and its relation to the Model Context Protocol. |
| [exsto-nextjs](exsto-nextjs/SKILL.md) | Next.js apps as presentation over MCP: call the server (never the DB), render substrate metadata, Supabase Auth + tenant binding. |

## Workflow skill (Tier 3, Exsto-specific)

| Skill | Purpose |
| --- | --- |
| [exsto-workflow](exsto-workflow/SKILL.md) | The Exsto build rhythm + which installed discipline (Superpowers/review/worktrees) to use, with the non-negotiable verify-on-DB gate. |

## Not included here

Generic engineering discipline (`brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`,
`systematic-debugging`, `verification-before-completion`, `requesting-code-review`,
`receiving-code-review`, `finishing-a-development-branch`, `using-git-worktrees`,
`writing-skills`), vendored document/deploy/framework tooling (`docx`, `pdf`, `xlsx`,
`webapp-testing`, `deploy-to-vercel`, `next-*`, `vercel-*`, `supabase*`,
`web-design-guidelines`, `writing-guidelines`), and anything else on disk not listed
above — see `MANIFEST.md` for those.
