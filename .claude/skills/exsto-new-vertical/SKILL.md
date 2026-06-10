---
name: exsto-new-vertical
description: Build a new product/vertical on the Exsto foundation WITHOUT touching the substrate — concepts become kinds, operations become MCP tools, the app calls an adapter (never the DB). ALWAYS consult this when starting a Layer 3 tool/vertical, adding a verticals/<name> or apps/<name> package, or whenever you feel the urge to change packages/substrate, packages/primitives, or a migration to make a feature work.
---

# Starting a new vertical on the foundation

The substrate is finished and shared; a vertical is **additive code that sits on top of it** (ADR 0029). If building your feature seems to require editing `packages/substrate`, `packages/primitives`, or a migration, that is almost always a signal you are about to fork the engine — stop and re-express the feature in substrate terms instead. The whole value of Exsto is that one verified engine serves every vertical; a per-vertical substrate change throws that away.

## The translation (this is the entire job)

| Your feature has... | In Exsto it is... | Skill |
| --- | --- | --- |
| "things" it tracks (matters, deals, candidates) | **entity kinds** — definition rows | exsto-add-kind |
| facts about those things | **attribute kinds** (+ judgment/outcome kinds) | exsto-add-kind |
| connections between things | **relationship kinds** | exsto-add-kind |
| operations users/agents perform | **action kinds → MCP tools** | exsto-mcp-tool |
| AI drafting / inference | **AI operations** with reasoning traces | exsto-ai-operation |
| screens | **reference-app surfaces calling MCP** | `docs/patterns/reference-app-surface.md` |

Concepts are configured as data; operations are dispatched through MCP over the action layer; reads are bitemporal; history is append-only.

## Where the code lives

- **`verticals/<name>/`** — vertical logic that is *not* substrate: prompt/templates (content, not code), the model adapter, integration adapters (stubbed if needed), domain queries, and `api/` functions that call `submitAction` / primitives. `verticals/legal/` is the working reference (templates, `adapters/claude.ts`, `api/generateDraft.ts`, queries).
- **`apps/<name>/`** — Next.js app(s). They call the MCP server through an MCP client wrapper and render substrate metadata (provenance, confidence, knowability, polarity). No direct DB access, and no custom REST route that does its own substrate work (REST is allowed only as an adapter over the operation core — exsto-rest-api).
- **Untouched:** `packages/substrate`, `packages/primitives`, `packages/mcp-tools` (generic), `supabase/migrations`. You may *add* a vertical-specific MCP tool file and *add* definition rows; you do not edit the engine.

## Rules

- **Every write flows through `submitAction`.** No raw INSERT from a vertical (verticals/legal/CLAUDE.md).
- **Model the domain object as an entity, not a parallel table.** (ADR 0032: a legal "matter" is an entity, there is no `legal_matter` table.) Resist the urge to add a bespoke table for your core object.
- **Templates/prompts are content.** Edit files under `templates/`, don't bury strings in source.
- **Additive, never destructive.** Adding a vertical never deletes or rewrites another vertical or the substrate.

## Gotchas

- **"I need a new column on `entity`"** → no; it's an **attribute kind** on your entity kind.
- **"I need a custom endpoint for the UI"** → no; it's an **MCP tool** (or, for a non-MCP client, the REST adapter over the same core — ADR 0024, ADR 0038). The app calls an adapter, never the DB.
- **"My concept doesn't fit any primitive"** → that's a rare Layer 1 question; surface it (it may mean a missing primitive), don't quietly bolt a table on.
- **Tenant = the customer.** A new vertical for a customer is a tenant + its kinds, not a code fork.

## Pointers to ground truth

- `verticals/legal/` and `verticals/legal/CLAUDE.md` — the reference vertical.
- `docs/patterns/reference-app-surface.md`; ADRs 0029 (Layer 3 convention), 0030, 0032, 0034.
- Sequenced by the `/newplatform` (stand up the foundation) and `/starterprompt` (shape the build) skills.

## Verify

The vertical works and the substrate is provably untouched:

```bash
git diff --name-only main -- packages/substrate packages/primitives supabase/migrations   # empty
corepack pnpm build && corepack pnpm test                                                  # green
```

Then an end-to-end slice runs entirely through MCP: define the kinds → `substrate.capability.list` shows them → an MCP write tool creates/updates your entity → a read tool / `entity.context` returns it with metadata intact. No new substrate table, no engine edit.
