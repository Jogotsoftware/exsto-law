---
name: exsto-workflow
description: The Exsto build rhythm — which borrowed discipline to apply when working the substrate, and the non-negotiable gate (verify on the live DB) before claiming done. ALWAYS consult this when starting a unit of substrate work, deciding how to approach a change, or before committing or declaring a task complete.
---

# The Exsto build rhythm

Exsto borrows proven workflow disciplines rather than reinventing them. This skill says which to reach for and adds the one gate the substrate cannot ship without: **every claim is verified against the live database, never asserted from prose.** A wrong "it's done" erodes the trust the substrate exists to provide.

## The loop (the project's working rhythm)

1. **Plan before building.** Brainstorm/spec first, then a written plan. Don't improvise architecture — if something doesn't fit cleanly, stop and write an ADR (`docs/product/03_PROJECT_STRUCTURE.md`, "per architectural decision").
2. **Read before touching.** Open the relevant `docs/patterns/*`, the ADR, and the per-package `CLAUDE.md` for the directory you're working in (root `CLAUDE.md`, "files to read before making changes").
3. **Test-first for substrate code.** Write/extend `tests/invariants/` when a change touches a guarantee (hard rule 10).
4. **Branch + commit incrementally when green.** Parallel sessions run on this repo — confirm ownership before pushing/merging.
5. **Verify on the DB, then review.** Run the checks below and request review before calling it done.

## Borrowed disciplines (installed — use, don't reinvent)

- **Process:** `brainstorming`, `writing-plans`, `systematic-debugging`, `test-driven-development`, `verification-before-completion`.
- **Review:** `requesting-code-review` / `receiving-code-review`, plus the project `invariant-auditor` subagent.
- **Isolation:** `using-git-worktrees` for parallel work.

Borrow one or two and adapt; do **not** bulk-install skill catalogs (Exsto authoring standard, Tier 3).

## The non-negotiable gate

Before you say "done", "fixed", or "passing" for anything touching the substrate: run the invariant suite and the **exsto-verify-tenancy** checks against the live DB. A green claim with no DB run — or with the DB-gated tests silently skipped (`SUBSTRATE_TEST_DATABASE_URL` unset) — is **not done**. This is hard rule 10 plus the authoring standard's cardinal rule.

## Pointers to ground truth

- Root `CLAUDE.md` (hard/soft rules, files-to-read, workflow expectations); `docs/product/03_PROJECT_STRUCTURE.md`; `.claude/agents/invariant-auditor.md`.
- Substrate skills: exsto-substrate-migration, exsto-verify-tenancy, exsto-query-substrate, exsto-mcp-tool, exsto-add-kind, exsto-ai-operation.

## Verify

"Done" means: the relevant pattern/ADR was read, the tests (including the DB-gated invariants) actually **ran** and are green, and the change was reviewed. If you cannot point to the command output proving the guarantee still holds, it is not done.
