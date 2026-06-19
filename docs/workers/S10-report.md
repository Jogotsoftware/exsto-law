# S10 — Client Portal & Accounts · Report to Manager

_main `2a56f77` · 2026-06-18 · Worker S10 · Lease `0076–0078` (reserved, **unwritten**)_

## Outcome: **HELD** (by Joe's decision), with reconciliation + contract checklist delivered

S10 did **not** build features this round. Two of three work packages depend on sibling work not yet
on `main`, the brief's premise was largely already shipped, and the one open identity decision is now
resolved. Per Joe (2026-06-18): **hold until dependencies land; merge no feature resting on
non-existent contracts.**

## Findings the Manager should fold into the BUILD-LOG

1. **The client portal is ~80% already live** (prior round): magic-link auth
   (`/api/client/auth/{request,consume,me,logout}`, 30-min single-use tokens), `/portal` matters +
   timeline, messaging (vertical mig `0015`), `/portal/sign` + `esignPortalTools` (S8 consumed),
   `/portal/pay`, and RLS isolation tests (`tests/vertical/client-portal-{policy,auth}.test.ts`).
   **Add to "Already-shipped overlaps."**
2. **The S10 brief's file-ownership map is fiction.** `src/features/portal/**`,
   `feature.manifest.ts`, `settings.manifest.ts` exist nowhere. Real layout: `apps/legal-demo/app/portal/**`
   + `verticals/legal/src/{queries,mcp}/clientPortal*`. The security seam is
   `verticals/legal/src/mcp/clientPolicy.ts` (`CLIENT_PORTAL_AUTHED_TOOLS`, default-deny). Recommend
   correcting the manifest/feature-registry premise across the worker briefs.
3. **Open item #1 (tenancy/client-identity) — RESOLVED by Joe: first-class client accounts.** Today a
   portal client is a session-over-contact (no persistent credential). Joe wants a real, persistent,
   tenant-scoped `client_account` distinct from `client_contact`. **This makes S10 hard-depend on S9**
   (auth foundation, not started).

## Cross-worker asks (Manager to route)

- **S9:** S10 needs a first-class `client_account` identity + RLS scoping reads to the account's own
  matters + a session carrying `{tenant_id, client_account_id, client_contact_id}`. **Decide credential
  storage ownership: S9 or S10?**
- **S5:** expose a core action `legal.booking.confirm` (client-callable); add a **booking-confirmation
  email** (sent via Contract B) that embeds the account-setup link (**fix #21**). No
  booking-confirmation template exists today.
- **S6/Contract J:** a query for a client's **released** documents (scoped to their matters) +
  render/download. Released-only; unreleased = `withheld`/invisible.
- **S2/Contract C:** confirm the nav-group registry actually exists (no manifest registry was found);
  if it's fiction too, S10 falls back to plain `/portal` routes.

## Deliverables this round (no feature merge)

- `docs/workers/S10-client-portal-plan.md` — reconciliation + full integration plan + reserved
  migration map (`0076–0078`, unwritten).
- `tests/vertical/s10-portal-contracts.test.ts` — green checklist: **5 standing-invariant/seam-pin
  tests pass, 6 receipt `it.todo`s** awaiting deps. (`vitest run` ✓ verified.)
- This report.

## Lease

`0076–0078` **untouched** (vertical ledger still maxes `0044`). Nothing to merge that could collide.
When S5/S6/S9 land, S10 unholds per the plan and writes `0076–0078`.
