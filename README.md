# Exsto

An operational data substrate exposed via MCP. Built so AI agents can reason across the full context of a business, with provenance, time, governance, and auditability built in from the foundation.

This README is the bootstrap guide. If you are reading this for the first time, follow it top to bottom and you should end up with a working local setup.

For the full vision, see `ARCHITECTURE.md`. For what gets built first, see `docs/product/02_LAYER_0-2_DEFINITION_OF_DONE.md`. For how it gets built, see `docs/product/03_PROJECT_STRUCTURE.md`.

## What this repo contains

- **The substrate.** A Postgres database designed around 23 invariants that every fact in the system inherits. Lives in `supabase/` and `packages/substrate`.
- **The primitives.** Seven core kinds of things (entity, attribute, relationship, event, judgment, outcome, action) plus their definition registries. Lives in `packages/primitives`.
- **The MCP server.** The only client-facing interface. Lives in `apps/mcp-server`. Tools live in `packages/mcp-tools`.
- **The worker runtime.** A general-purpose process that runs jobs (reminders, projections, scheduled tasks) in the background. Lives in `workers/runtime`.
- **An example vertical (legal).** A Layer 3 wedge for Pacheco Law (operating-agreement workflow) included as a worked example of how to build on the substrate — library + templates + adapters in `verticals/legal`, demo UI in `apps/legal-demo`. It is NOT part of the substrate; a new tool deletes it and builds its own vertical. See `docs/product/01_HOW_TO_START_A_NEW_TOOL.md`.

> **Building a new AI-native tool on this substrate?** Start on the `core-substrate` branch (clean substrate, this branch) and read `docs/product/01_HOW_TO_START_A_NEW_TOOL.md`. The `main` branch is the law-firm production fork; `substrate-and-legal-wedge` is the full legal example.

## Prerequisites

You need these installed on your machine before anything else works.

### 1. Node.js 20 or later

Check with:

```bash
node --version
```

If you don't have it or have an older version, install it from https://nodejs.org or use a version manager like `nvm`.

### 2. pnpm (the package manager this repo uses)

Install once, globally:

```bash
npm install -g pnpm
```

Verify:

```bash
pnpm --version
```

We use pnpm instead of npm because it's faster and handles monorepos cleanly. If you have never used it, the only command you need to know to start is `pnpm install`.

### 3. Supabase account and project

The substrate runs on Postgres, hosted by Supabase.

1. Go to https://supabase.com and create an account (free tier is fine to start).
2. Create a new project. Pick a region close to you.
3. Wait for the project to provision (a few minutes).
4. From the project dashboard, grab these values; you will paste them into a local `.env.local` file in the next step:
   - **Project URL** (under Settings → API)
   - **Anon public key** (under Settings → API)
   - **Service role key** (under Settings → API; keep this one secret)
   - **Database connection string** (under Settings → Database → Connection string → URI)

### 4. Supabase CLI (required)

`pnpm migrate` and `pnpm db:reset` run through it. It applies the migrations in `supabase/migrations/` and the seed in `supabase/seed/` (wired in `supabase/config.toml`).

```bash
npm install -g supabase
```

Verify:

```bash
supabase --version
```

## Local setup

### Clone the repo

```bash
git clone <your-repo-url> exsto
cd exsto
```

### Install dependencies

From the repo root:

```bash
pnpm install
```

This installs every package's dependencies in one shot. It uses a shared store on your machine, so installs are fast.

### Build the workspace

```bash
pnpm build
```

This compiles every TypeScript package in the workspace using the root build graph.

### Configure environment variables

Copy the template and fill in the values you grabbed from Supabase:

```bash
cp .env.example .env.local
```

Open `.env.local` and paste in:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:your-password@db.your-project-ref.supabase.co:5432/postgres
```

`.env.local` is in `.gitignore` so it never gets committed. The values you paste here are secrets.

> **Connection roles (ADR 0037).** The `DATABASE_URL` from the dashboard uses the `postgres` owner role, which **bypasses row-level security**. Use it only for migrations and seeding. Application and worker code must connect as a **non-owner** role (Supabase `authenticated`/`anon`, or a dedicated app role) or tenant isolation is silently off. Set `SUBSTRATE_TEST_DATABASE_URL` to a disposable project for the test suite.

### Run the migrations

The schema is a series of migration files in `supabase/migrations/`; the customer-agnostic seed is in `supabase/seed/`. Link your project once, then push:

```bash
supabase link --project-ref <your-project-ref>   # one-time
pnpm migrate                                      # supabase db push — applies all migrations in order
pnpm seed                                         # applies supabase/seed to DATABASE_URL
```

The first migration creates the foundational tables (tenant, actor, action, action_kind_definition) with row-level security enabled; later migrations add the full Layer-2 primitive set, append-only/bitemporal enforcement, and migration history.

Fully local alternative (no remote project): `supabase start` spins a local Postgres and applies migrations + seed automatically; `pnpm db:reset` rebuilds it from scratch.

### Run the demo app

```bash
pnpm dev:web    # http://localhost:3000
```

This is the single Next.js app (`apps/legal-demo`) that hosts both the attorney surface (`/attorney/*`) and the client portal (`/client/*`). API routes call the substrate directly server-side — no separate MCP server process required.

Start the standalone MCP server (only if you need a stdio MCP endpoint for IDE integration etc.):

```bash
pnpm dev:mcp
```

Start the worker runtime (when scheduled jobs land):

```bash
pnpm dev:worker
```

### Verify the setup

Run the test suite:

```bash
pnpm test:unit                                    # no DB — always runs
SUBSTRATE_TEST_DATABASE_URL=<disposable-db-url> pnpm test:invariants   # full Layer-1 invariant suite
```

`test:unit` covers the no-DB invariants (HLC ordering, worker backoff). `test:invariants` runs the full suite (tenant isolation, append-only enforcement, bitemporal protection, grants lockdown, migration history, engine round-trip) against a live database; without `SUBSTRATE_TEST_DATABASE_URL` the DB-gated tests skip. CI runs the full suite against a fresh Supabase stack so a green check means every invariant test actually executed.

### Drive the wedge end to end

Run `pnpm seed:demo` first to load the Pine Hollow Roasters matter, then with `pnpm dev:web` running open:

- <http://localhost:3000/attorney?demo_user=juan-carlos> — attorney dashboard with the seeded matter.
- <http://localhost:3000/client?demo_user=marcus-holloway> — client portal with the intake form pre-filled.
- From the attorney matter detail page: open the latest draft to see the side-by-side review screen with structured reasoning trace, evidence with source badges, alternatives, and ambiguity flags.

Full walkthrough is in `verticals/legal/demo/RUNBOOK.md`. Netlify deploy steps are in `verticals/legal/demo/DEPLOY.md`.

## Common commands

```bash
pnpm install            # Install all dependencies
pnpm test               # Run all tests
pnpm test:invariants    # Run only the layer 1 invariant tests
pnpm lint               # Lint everything
pnpm format             # Format everything with Prettier
pnpm build              # Build all packages
pnpm dev:web            # Run the demo app (port 3000)
pnpm dev:mcp            # Run the standalone stdio MCP server (optional)
pnpm dev:worker         # Run the worker runtime in dev mode
pnpm seed:demo          # Reset the Pacheco Law tenant and load the Pine Hollow matter
pnpm preflight          # Check DB/Anthropic/seed/ports before a demo
pnpm migrate            # Apply pending Supabase migrations
pnpm db:reset           # Reset the database to a clean state (local dev only)
```

## Working with Claude Code

This repo is set up to work with Anthropic's Claude Code. Two community plugins make Claude Code substantially more effective; install both before you start building:

```bash
# In a Claude Code session:
/plugin marketplace add obra/superpowers
/plugin install superpowers@superpowers-marketplace

/plugin marketplace add wshobson/agents
/plugin install comprehensive-review@claude-code-workflows
/plugin install backend-development@claude-code-workflows
/plugin install database@claude-code-workflows
```

Project-specific Claude Code configuration (subagents, skills, hooks) lives in `.claude/`. The top-level `CLAUDE.md` tells Claude Code the rules for working in this repo.

When Claude Code starts a session in this repo, it reads `CLAUDE.md` automatically. When you work in a subdirectory, it also reads that subdirectory's `CLAUDE.md`.

## Where to learn more

- **The architecture.** `ARCHITECTURE.md` is the constitutional document. Every decision in the codebase serves it.
- **What gets built first.** `docs/product/02_LAYER_0-2_DEFINITION_OF_DONE.md` is the contract for the substrate.
- **How it gets built.** `docs/product/03_PROJECT_STRUCTURE.md` covers the monorepo shape, build sequence, and per-package rules.
- **Concepts to study.** `docs/learning/concepts-to-study.md` is a running glossary of terms and ideas that come up during construction. If you encounter something unfamiliar, check there first.
- **ADRs.** Architecture Decision Records live in `adr/`. Each documents one important decision and why it was made.
- **Patterns.** Code patterns Claude Code copies from live in `docs/patterns/`. If you are about to write something new, check whether a pattern already exists.

## License

Private. No license posture committed yet. Decision deferred until the first paying customer engagement is closer.
