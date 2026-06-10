# ADR 0025: Monorepo with pnpm workspaces

## Status
Accepted

## Context
Exsto comprises multiple packages and runnable processes that share types, schemas, and tooling: substrate engine, primitives, MCP tools, MCP server, worker runtime, reference app. They evolve together. A change to a primitive's type ripples to every consumer. A change to a substrate query helper affects every package that uses it.

Two organizational options: monorepo (one git repo with multiple packages) or polyrepo (one repo per package). For tightly-coupled packages that ship together, monorepos are well-established practice.

For package management within the monorepo, the options are npm, yarn, and pnpm. pnpm has a strict dependency model that prevents "phantom dependencies" (a package using something it didn't declare) and a content-addressable store that makes installs fast.

## Decision
Single git repository with pnpm workspaces.

Structure:
- `packages/` for libraries (substrate, primitives, mcp-tools, shared)
- `apps/` for runnable user-facing services (mcp-server, reference)
- `workers/` for runnable background services (runtime)
- `supabase/`, `adr/`, `docs/`, `tests/` for cross-cutting concerns

Each package has its own `package.json`. The root `pnpm-workspace.yaml` declares the workspace members. Internal dependencies use `workspace:*` protocol so packages always link to local sources, not registry versions.

TypeScript: shared `tsconfig.base.json` at the root; each package extends it with package-specific settings.

Linting and formatting: ESLint and Prettier configurations at the root, applied to all packages.

Tests: each package has a Vitest configuration; the root `pnpm test` runs all of them.

CI: GitHub Actions runs linting, type checking, and tests across all packages on every PR.

## Consequences

What's now easier:
- Shared types across packages. A primitive type defined in `packages/primitives` is imported directly by `apps/reference` and `apps/mcp-server`.
- Cross-package refactors. Renaming a function gets refactored across all packages in one PR.
- Atomic commits. A change that touches schema, primitives, MCP tools, and the reference app lands in one commit.
- Bootstrapping. New developers run `pnpm install` once and have everything ready.

What's now harder:
- Build orchestration. Building the monorepo requires understanding dependencies between packages. pnpm handles this; tooling like Turborepo can be added if build times become a concern.
- Selective deployment. Shipping just `apps/mcp-server` to production requires knowing which packages it depends on. Build outputs are scoped per package.
- Repo size grows. Acceptable; git handles large monorepos well.

## Alternatives considered

**Polyrepo (one repo per package).** Rejected: increases coordination overhead. Cross-package changes require multiple PRs in multiple repos.

**Monorepo with npm or yarn workspaces.** Considered. Both work. pnpm's strict mode prevents a class of phantom-dependency bugs that show up later. Worth the small ergonomic cost.

**Monorepo with Lerna or Nx.** Lerna is essentially deprecated. Nx adds tooling and complexity that isn't yet justified at our scale. We can adopt Turborepo or Nx later if build performance demands.

**Bun workspaces.** Considered. Younger ecosystem. Some library compatibility issues. Stick with pnpm for now.
