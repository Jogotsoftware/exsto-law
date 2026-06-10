# Vertical migrations (clone-owned)

This directory holds the **vertical** migration sequence — schema changes authored
by a clone for its Layer-3 vertical. It is **separate** from the core sequence
(`supabase/migrations/`, foundation-owned) on purpose: two disjoint namespaces with
two ledgers, so a foundation upgrade's new core migrations never collide with your
migrations (ADR 0043).

## Rules

- **Author here, never in `supabase/migrations/`.** That directory is overwritten
  by `exsto-upgrade-foundation`; anything you put there will be clobbered.
- Number files in your own sequence: `0001_add_invoice_kind.sql`,
  `0002_…`. The number before the first `_` is the ledger version.
- Applied files are **immutable** — the runner records a checksum and refuses to
  re-run a changed file. Correct forward with a new migration.
- Same invariant discipline as core: every new table gets `tenant_id` + RLS +
  append-only/bitemporal protection where it holds history (see the
  `exsto-substrate-migration` skill). Prefer **kinds over tables** — most vertical
  concepts are `kind.define` rows, not new tables (schema-as-data).

## How it runs

`pnpm migrate` applies the **core** sequence first (`supabase db push`), then this
**vertical** sequence (`scripts/migrate-vertical.mjs`), recording each file in
`private.vertical_migration`. `pnpm db:reset` and CI do the same, in that order.
