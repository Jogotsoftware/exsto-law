# ADR 0035: Dev-only `?demo_user` query param for wedge identity

## Status
Accepted

## Context
The wedge demo for Pacheco Law has to be runnable by the founder on his laptop in front of Juan Carlos without a real authentication flow in place. The substrate has the right notion of identity already — the action layer requires an actor_id on every write, and the per-tenant `actor` table is populated by the demo seed with Juan Carlos (the attorney), Sage (the drafting agent), and a public-intake system actor that stands in for unauthenticated client portal submissions. What is missing is the UI-side notion of "who is currently using this app."

Building real auth (Supabase Auth, magic links, session cookies) is a multi-day effort that does not move the demo forward, and any auth choice we make now will probably be revisited when the first real customer arrives.

## Decision

Both Next.js apps read a `?demo_user=<key>` query parameter on first mount. If present, the value is cached in `sessionStorage` and resolved against a small hard-coded map of known identities (`apps/legal-attorney/lib/demoUser.ts`, `apps/legal-client/lib/demoUser.ts`). The resolved identity is used purely for client-side rendering:

- **Attorney app**: header shows "Signed in as Juan Carlos Pacheco" when `demo_user=juan-carlos`.
- **Client portal**: intake form's contact name and email fields pre-fill from the identity (`marcus-holloway` → Marcus's name + email; `priya-iyer` → Priya's). The pre-fill never overwrites manual edits.

The actor_id used for substrate writes is **not** affected by `demo_user`. The attorney app's `/api/mcp` route always sends Juan Carlos's actor_id; the client portal's route always sends the public-intake system actor. The query param controls *presentation*, not *authorization*.

The mechanism is gated by `NODE_ENV !== 'production'` at the route handler level (the API route ignores any caller-supplied actor override if NODE_ENV is production; the pre-fill itself is harmless and stays on). Production deployments of these apps will require real auth and the query param will become a no-op.

## Consequences

### What this makes easier
- The founder can paste a single URL into a browser and the app behaves as if the right person were already signed in.
- Identity-driven UI behaviors (pre-fill, header indicators) can be built and demoed before auth ships.
- The substrate-side actor model is already correct; nothing has to be retrofitted when real auth arrives.

### What this makes harder
- Anyone with the URL can pretend to be any of the demo identities. This is fine for a local laptop demo and clearly inappropriate for production — which is why the gate is `NODE_ENV !== 'production'` and the runbook notes that the auth story has to be in place before any external deployment.
- The hard-coded identity map in `lib/demoUser.ts` has to be kept in sync with the seed actor list. Three identities is not a maintenance problem; it would become one if it grew.

## Alternatives considered
- **Build real auth (Supabase Auth).** Right answer for production; wrong investment for the demo session.
- **Hard-code a single identity per app.** Loses the ability to demo "what does Priya see on the client portal vs Marcus." The query param mechanism gives us multiple identities at marginal cost.
- **Use a cookie-based session created at first visit.** No incremental value over `sessionStorage` for a single-user demo and adds complexity (cookie issuance, expiry, /api endpoints to set it).

## Accepted
Yes. Implemented in both apps' `lib/demoUser.ts` and used by the attorney header and the client intake form. Must be replaced by real auth before any external deployment.
