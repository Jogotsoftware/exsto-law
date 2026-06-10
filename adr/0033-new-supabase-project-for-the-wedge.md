# ADR 0033: A new Supabase project (`exsto-wedge`) for the wedge

## Status
Accepted

## Context
The existing `exsto-dev` Supabase project (`vjpqtzxtxhisbuaerfbb`) has migration 0001 applied but had been paused/inactive. Continuing on it would have required restoring the project (bringing back any prior data and incurring its full active billing) and creating a development branch from it. Both steps add cost and entangle the wedge build with whatever state had accumulated in `exsto-dev`.

The wedge needed a clean substrate matching the new migration sequence (0001 + the rewritten 0002–0005 + the legal vertical seed) without ambiguity about whether old test data was contaminating queries.

## Decision

Create a new Supabase project `exsto-wedge` (`qlqkpuyhppfodmpeybcz`, us-east-1, free tier, $0/month). Apply all five migrations and the seed there. Treat this project as the wedge's canonical dev DB.

`exsto-dev` is left untouched. The founder decides whether to (a) retire `exsto-dev` and consolidate everything on `exsto-wedge`, or (b) restore `exsto-dev`, apply migrations 0002–0005 there, and use it as the substrate-only sandbox while `exsto-wedge` stays customer-vertical-specific.

## Consequences

### What this makes easier
- A clean schema with deterministic seed, easy to reproduce by re-running the migration files.
- No coupling between substrate evolution and Pacheco Law data.
- Free-tier cost ($0/month) keeps the experiment cheap; auto-pause after one week of inactivity is acceptable for a dev DB.

### What this makes harder
- Two Supabase projects to keep track of. The founder must update `.env.local` with `exsto-wedge`'s connection string and decide which project is canonical.
- Migration history on `exsto-wedge` lists this session's applications; if you re-run from `supabase/migrations/` you will get duplicate migration entries unless you reset.

## Alternatives considered
- Restore `exsto-dev` and apply 0002–0005 there. Rejected for cost (restoration brings back active billing) and contamination (any prior data is still there).
- Use a development branch off `exsto-dev`. Rejected because branches require the parent project active, which has the same cost issue, and because branches inherit migration history we did not want to inherit.

## Accepted
Yes. The wedge schema and seed live on `exsto-wedge`. `exsto-dev` is unaffected and the founder picks its long-term role.
