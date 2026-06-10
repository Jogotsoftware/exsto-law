# ADR 0043: Clone upgrade path — git-playbook distribution, additive-only core contract, core/vertical migration namespaces

## Status

Accepted. The last gate before client cloning (`docs/FOUNDATION_CERTIFICATION.md`).
Defines how an existing clone receives substrate updates after it has grown a
Layer-3 vertical. Implemented in migration 0026, `scripts/migrate-vertical.mjs`,
`scripts/stamp-version.mjs`, `scripts/upgrade-foundation.mjs`, the
`exsto-upgrade-foundation` skill, and the `newplatform` skill update. Companion:
`docs/UPGRADE_PATH.md`.

## Context

Certification proved a clone can be *created* hands-free and is correct at
creation. It did not prove how a clone **receives foundation updates** once it has
diverged — the open gate. A clone has its own Layer-3 code (`verticals/<name>`,
`apps/<name>`) and its own data; the foundation keeps shipping new core migrations,
substrate code, ADRs, and skills. Without a defined path, every clone is a
permanent fork that either never gets fixes or gets them by risky hand-merging.

### Assessment of the actual structure (which distribution model?)

- The substrate is **4 workspace packages** (`@exsto/shared`, `@exsto/substrate`,
  `@exsto/primitives`, `@exsto/mcp-tools`), all `workspace:*`, `private: true`,
  v0.0.0. Apps/verticals consume them **internally**, not as external registry
  dependencies.
- A clone is created with `gh repo create --template` — a **full copy of the
  monorepo**. The clone therefore carries the substrate *source*, not a dependency
  on a published artifact.
- GitHub Packages publishing of `@exsto/*` is **blocked**: GHP requires the package
  scope to match the GitHub owner (`@jogotsoftware`), and renaming the whole
  `@exsto` scope across the monorepo is a large, high-risk change for a capability
  no same-shape clone would use.

**Conclusion:** the structure is a **template monorepo**, not a
published-library-consumer model. The fitting upgrade model is **template + git
playbook**: a clone pulls the foundation-owned paths from a `foundation` git remote
at a tagged version. Semver versioning is still adopted (it is the foundation's
version identity, and it is what the clone stamps and compares), and registry
publishing is **wired but secondary** (forward-looking, for a future clone that
externalizes the substrate as a dependency; blocked today by the scope).

## Decision

### 1. Distribution: git-playbook sync of foundation-owned paths

A clone declares a `foundation` git remote (the canonical repo). Upgrading checks
out the **foundation-owned paths** at the target version tag into the clone's
working tree, overwriting them. Foundation-owned paths (the clone never edits
these — see the contract):

```
packages/{shared,substrate,primitives,mcp-tools}   supabase/migrations/
apps/{mcp-server,rest-api}                          scripts/ (foundation tooling)
.claude/skills/exsto-*  .claude/skills/newplatform  CLAUDE.md  ARCHITECTURE.md  adr/
VERSION  package.json (root, foundation-managed fields)
```

Clone-owned paths the upgrade NEVER touches: `verticals/*`, `apps/<vertical-app>`,
`supabase/migrations_vertical/`, the clone's `.env.local`, and any
`packages/<vertical>-*` the clone added. This separation is what makes an upgrade
safe: it is a controlled overwrite of paths the contract reserves to the
foundation.

The substrate packages are **versioned with semver** starting at **1.0.0**
(`VERSION` is the single source of truth, mirrored into the substrate packages'
`package.json`). A GitHub Actions publish workflow is wired (`.github/workflows/
publish.yml`) for the externalized-consumer case; it is gated on the `@exsto` →
org-scope prerequisite, documented inline.

### 2. Compatibility contract (what the foundation may and may not do)

Core changes are **additive-only** with respect to any surface a vertical can
touch:

- **Never drop or rename** a table, column, function, view, or kind that exists in
  a released core version. Deprecate by adding the replacement and leaving the old
  in place.
- **New columns are nullable or defaulted.** A core migration must apply cleanly to
  a clone that has data.
- **Kind definitions are never removed.** Verticals reference kinds by name;
  removing one breaks their data. New kinds are fine.
- **New migrations only append** to the core sequence; an already-released core
  migration file is immutable (never edited in place).
- **Semver:** additive change → minor; bugfix → patch; any breaking change to the
  above → **major**, and a major requires a written migration guide
  (`docs/upgrades/<from>-to-<to>.md`) that the upgrade runner surfaces and refuses
  to auto-apply across.

The upgrade runner enforces the mechanical half (it refuses to cross a major
boundary without an acknowledged guide; it runs the invariant suite after applying
and rolls forward only if green).

### 3. Migration namespaces: core vs vertical

Two disjoint sequences in two directories with two ledgers:

| | Directory | Ledger | Owner | Applied by |
|---|---|---|---|---|
| **Core** | `supabase/migrations/` | `supabase_migrations.schema_migrations` (+ `public.schema_migration`) | foundation | stock `supabase db push` / `supabase start` |
| **Vertical** | `supabase/migrations_vertical/` | `public.vertical_migration` (migration 0026) | clone | `scripts/migrate-vertical.mjs` (core-then-vertical) |

Verticals **never** author in `supabase/migrations/`. Because the two sequences
live in separate directories with separate ledgers, a foundation upgrade adds files
only to `supabase/migrations/`; `supabase db push` applies the new core migrations
with no awareness of — and no number collision with — the vertical sequence. This
directly avoids the failure mode observed on `exsto-dev`, whose ledger carries
*timestamp-named* migrations that no longer match the repo's sequential `0001–0025`
names: a single shared namespace lets independently-authored migrations collide and
desynchronize. Two namespaces cannot.

Tooling runs **core then vertical**, always in that order: `pnpm migrate`,
`pnpm db:reset`, and CI all apply core (+ seed) first, then vertical.

### 4. Version stamp + upgrade audit

- At **bootstrap**, the clone records its foundation version in
  `system_capability_registry` (tenant zero): `snapshot.foundation = { version,
  commit, stamped_at }`. `scripts/stamp-version.mjs`; wired into `newplatform`.
- Each **upgrade** is recorded as a governed `config.change` action plus a
  `configuration_change` row (change_kind `foundation_upgrade`, before/after
  version), and appends to `snapshot.foundation.history`. Written by
  `scripts/upgrade-foundation.mjs` (migration-class deployment tooling, which the
  hard rules permit direct DB access for).

## Consequences

**Enables**
- A clone can take foundation fixes and new core capabilities with one command,
  with the invariant suite as the gate, without hand-merging.
- "What foundation version is this clone on, and what upgrades has it taken" is a
  single query against `system_capability_registry`.

**Obligations**
- The foundation must hold the additive-only contract. A genuinely breaking change
  is a major bump with a written guide — never a silent in-place edit of a released
  migration.
- Verticals must respect the namespace split (author only in
  `supabase/migrations_vertical/`) and never edit foundation-owned paths, or an
  upgrade's overwrite will clobber their changes. `newplatform` and CLAUDE.md state
  this.

**Deferred**
- Registry (GitHub Packages) publishing is wired but not the active path; it
  becomes primary only for a clone that externalizes the substrate as a dependency,
  which requires resolving the `@exsto` scope (an `exsto` org or a scope rename).
- Automatic conflict detection if a clone *did* edit a foundation-owned path is not
  built; the contract forbids it and the upgrade overwrite is the (blunt)
  enforcement. A pre-upgrade "clone touched a foundation path" check is a follow-up.
