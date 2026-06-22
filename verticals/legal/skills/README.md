# Assistant skills

Reusable **legal playbooks** the attorney chatbot loads on demand — ported and
adapted from Anthropic's [claude-for-legal](https://github.com/anthropics/claude-for-legal)
(NDA triage, vendor/MSA review, termination review, trademark clearance, demand
letters, legal research, and more, across every practice area).

A skill is **substrate data**, not code (hard rule #8). The firm can edit a
skill's positions or add a new one without a code change.

## How it works

1. **Storage (schema-as-data).** Each skill is a `skill` entity with attributes
   `skill_slug`, `skill_name`, `skill_practice_area`, `skill_description`,
   `skill_when_to_use`, `skill_body`, `skill_user_invocable` — defined in
   migration `supabase/migrations_vertical/0082_skill_library.sql`. Writes go
   through the `legal.skill.create` / `legal.skill.update` actions (and the core
   `entity.archive`); there is no direct SQL.

2. **Progressive disclosure.** Every Claude turn, the assistant's system prompt
   carries only the lightweight **catalog** (`slug — name: when-to-use`, grouped
   by practice area — see `listSkillCatalog`). When the attorney's request matches
   a skill, the model calls the `load_skill` tool, which fetches that one skill's
   full body (`getSkillBySlug`) into context. 100+ skills stay cheap because the
   long bodies load only when triggered.

3. **UI.** When a skill loads, the stream emits a `skill` event and the chat shows
   a "Using NDA review" chip. Routing is automatic (model-driven); there's no
   picker to learn.

4. **Sibling adapter.** `legal.skill.list/get/create/update/archive` expose the
   same operations over MCP (ADR 0024/0038 — one core), so the firm can manage
   skills programmatically.

## The content

`<practice-area>/<slug>.md` — markdown with single-line frontmatter:

```
---
slug: commercial.nda-review
name: NDA Review
practice_area: commercial
description: <one line>
when_to_use: <one line — when the assistant should load this>
user_invocable: true
---
<the adapted instruction body>
```

The adaptation keeps the legal substance and **all** guardrails (every output is
a draft for attorney review, not legal advice; privilege/destination checks;
jurisdiction surfaced; the attorney owns the conclusion) and drops the
Claude-Code-runtime plumbing (config-dir reads, slash commands, matter-workspace
files), re-homing matter/client context onto the substrate.

## Seeding

The markdown files are the version-controlled **defaults**; the substrate copy is
what the firm edits. Seed them (idempotent — upsert by slug, never deletes):

```
pnpm --filter @exsto/legal build   # the seed imports @exsto/legal
pnpm seed:skills                   # tsx --env-file=.env.local
```

## Adding or changing a skill

- **Edit in place:** change the `.md` and re-run `pnpm seed:skills`, or edit the
  live skill via `legal.skill.update` (the firm-facing path).
- **New skill:** drop a new `<area>/<slug>.md` with the frontmatter above and
  re-run the seed.

## Deploy note

Migration `0082` is **additive and idempotent** (new definition rows only) and is
invisible to existing features until the loader ships. Apply it the normal way
after this branch is reviewed:

```
pnpm migrate:vertical   # applies 0082 (skips already-applied files)
pnpm seed:skills        # loads the skill content into the tenant
```
