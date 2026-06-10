---
name: exsto-nextjs
description: The Exsto way of building Next.js apps on the substrate — App Router calling the MCP server (never the DB), rendering substrate metadata, Supabase Auth with tenant binding. ALWAYS consult this when building/editing apps/legal-demo or apps/<vertical>, adding a screen, wiring data into a React component, or when tempted to add a Next.js API route that does substrate work.
---

# Building a Next.js app on Exsto

An Exsto app is a **presentation layer over the operation core**, nothing more. It calls the MCP server through a client wrapper, renders what comes back — *including the substrate metadata* — and writes only by invoking MCP write tools. The same constraint a customer's client would face applies to our own apps: no direct Postgres access, and no "just for the UI" route that does its own substrate work. The app talks to an adapter (MCP today; a REST adapter is the permitted sibling — ADR 0024, ADR 0038); it never reaches past the adapter to the database.

## The shape

- **App Router** under `app/` (`apps/legal-demo` is the real app — the merged demo, ADR 0036). UI components in `components/`, helpers in `lib/`.
- **Data in** via an MCP client wrapper (`lib/`), calling read tools (`entity.list_by_kind`, `entity.context`, `attribute.history.get`, ...). The reference app uses the MCP server's **HTTP** transport.
- **Writes** via MCP write tools (`entity.create`, `attribute.set`, `judgment.record`, ...). A user edit becomes an action through MCP, recorded in the audit log. No shortcut.
- **Auth** via Supabase Auth with tenant binding — the app sets the tenant the same way a customer client would. Demo surfaces may select the actor via a demo-user query param (ADR 0035).

## Render the metadata, don't hide it

Every substrate value arrives with `provenance`/`source_type`, `confidence`, `knowability_state`, and (judgments/outcomes) `polarity`. Surface them — a value typed by a human should look different from one an AI inferred, and `never_observed` should look different from `observed_null`. Hiding metadata throws away the substrate's whole point. Build small badge/tag components (`ProvenanceTag`, `ConfidenceBadge`, `KnowabilityIcon`) and use them on every surface (see `docs/patterns/reference-app-surface.md`).

## Rules

- **No direct DB calls.** Importing `setAttribute` from `@exsto/primitives` into a component, or querying Postgres from a route handler, bypasses MCP — forbidden.
- **No substrate work in app routes.** A Next.js API route that does its own substrate work (raw SQL, or `@exsto/*` writes) is the tempting anti-pattern. The app calls an adapter — the MCP server, or the REST adapter over the same core — never the substrate itself.
- **AI surfaces include feedback.** A chat/AI surface wires "good" → a judgment and "wrong" → a contestation, both through MCP tools — feeding the AI-effectiveness loop (ADR 0028).
- **Dev/build:** `pnpm dev:web` (or `pnpm --filter @exsto/<app> dev`); `pnpm build` typechecks. Deploy via Netlify (`netlify.toml`, ADR 0036).

## Gotchas

- **Server Components calling MCP** is fine; just keep the tenant/auth context flowing — don't leak one tenant's data through a cached fetch.
- **"It's faster to query directly"** — no. Optimize the tool or the action layer, never bypass it.
- **New surface seems to need a new primitive** → that's a substrate question, not an app change. Surface it; usually it's a new kind (exsto-add-kind) or a new tool (exsto-mcp-tool).

## Pointers to ground truth

- `apps/legal-demo/` (the real app) and its `CLAUDE.md`; `docs/patterns/reference-app-surface.md`.
- ADRs 0024 + 0038 (operation core / adapters), 0035 (demo-user query param), 0036 (merged demo app); exsto-mcp-tool, exsto-query-substrate.

## Verify

The app is a clean MCP client: `git grep -nE "from '@exsto/(primitives|substrate)'" apps/<app>` is empty (no direct substrate imports); there is no API route performing DB writes; `pnpm build` typechecks; and every rendered substrate value shows a provenance/confidence/knowability affordance somewhere on the surface.
