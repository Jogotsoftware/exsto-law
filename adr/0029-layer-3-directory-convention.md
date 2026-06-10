# ADR 0029: Layer 3 legal vertical directory convention

## Status
Accepted

## Context
The upstream repository is a substrate monorepo with packages for shared types, substrate engine, primitives, and MCP tools. The fork must build a Layer 3 legal vertical wedge for Pacheco Law Firm while preserving the substrate's clear separation from customer-specific code.

The fork needs a directory convention that:
- keeps the substrate packages cleanly separated from the legal vertical
- supports a real attorney and client UI surface for the wedge
- makes it obvious which code is vertical-specific and which code is reusable substrate infrastructure
- fits the current monorepo layout and the existing `apps/` workspace pattern

## Decision
The legal wedge will be organized as:
- `verticals/legal/` for wedge-specific templates, prompt definitions, integration adapters, and domain-specific workflow configuration
- `apps/legal-attorney/` for the attorney-facing Next.js app
- `apps/legal-client/` for the client-facing Next.js app

This keeps the legal vertical as a distinct composition layer on top of the substrate while preserving the existing application workspace layout.

## Consequences
### What this makes easier
- The substrate remains clearly isolated in `packages/`.
- Vertical-specific content and hardcoded templates do not pollute the substrate package namespaces.
- Attorney and client apps can be developed independently while sharing MCP tools and substrate packages.
- Future verticals can follow the same convention: `verticals/<domain>/`, `apps/<domain>-attorney/`, `apps/<domain>-client/`.

### What this makes harder
- There is a small amount of additional directory navigation compared to keeping everything in `packages/`.
- Shared vertical adapters may need explicit imports from a non-package directory instead of a workspace package, though `pnpm` supports `workspace:` dependencies and the apps can still import from the `verticals/legal/` directory if needed.

## Alternatives considered
- Put wedge code under `packages/legal-*`. Rejected because it blurs the distinction between substrate primitives and customer-specific vertical code.
- Put apps under `packages/legal-client` and `packages/legal-attorney` only. Rejected because the repo already uses `apps/` for runnable surfaces; keeping UI under `apps/` matches the existing convention.

## Accepted
Yes. `verticals/legal/` for wedge assets and adapters, `apps/legal-attorney/` and `apps/legal-client/` for UIs.
