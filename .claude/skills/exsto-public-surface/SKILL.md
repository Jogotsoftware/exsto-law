---
name: exsto-public-surface
description: Secure a clone's PUBLIC, unauthenticated edges — booking/intake forms, shared-link pages, OAuth callbacks, webhooks. The substrate enforces tenancy/append-only at the DB, but these app-layer edges are code the DB can't protect. ALWAYS consult this when adding an unauthenticated route handler, a public MCP/REST endpoint, a public form that writes, an OAuth init/callback, a post-login redirect, or a shared-by-link page. Grounded in three real holes found and fixed in the legal clone.
---

# Securing a clone's public surface

Layer-1 invariants protect what reaches the **operation core**: RLS scopes every
query, append-only triggers reject mutation, provenance is mandatory. None of
that protects the **public, unauthenticated edges** a clone grows — a booking
form, a `/d/[id]` shared-link page, an OAuth callback, an inbound webhook. Those
are ordinary app code, and they are where real holes live. Three were found in
the legal clone by a security audit; each is a class of bug, not a one-off.

## 1. A public MCP/REST route must default-deny with an allowlist

Every tool registers into ONE flat registry. If both the authenticated route and
an **unauthenticated** route resolve names against it, the public route can
invoke **any** tool — read another surface's data, trigger billable AI calls,
write to the substrate as the public actor. The fix is a default-deny allowlist,
and the **vertical owns it** (it owns the tools):

```ts
// verticals/<vertical>/src/mcp/clientPolicy.ts — a security boundary, keep minimal
export const CLIENT_PORTAL_TOOLS: ReadonlySet<string> = new Set([
  'legal.service.list', 'legal.calendar.availability',
  'legal.booking.submit', 'legal.draft.get',          // exactly what the public UI needs
])
export const isClientPortalTool = (n: string) => CLIENT_PORTAL_TOOLS.has(n)
```

```ts
// app/api/<public>/mcp/route.ts — non-allowlisted gets the SAME 404 as unknown
const tool = isClientPortalTool(body.toolName) ? findTool(body.toolName) : undefined
if (!tool) return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
```

Same 404 for blocked and unknown = no oracle for which attorney-only tools exist.
A test locks the boundary: research/write tools are NOT in the set; the set
contains only the known-safe public tools and all resolve.

## 2. An unauthenticated write must be rate-limited (CAPTCHA in production)

A public write (booking/intake) runs as a fixed actor and, on **every** call,
creates entities + queues notification/calendar jobs. With no throttle that is
unbounded matter creation, email spam, calendar spam — DoS, DB bloat, real cost.
Frontend validation is bypassed by hitting the API directly. Add a per-IP
fixed-window limiter as the first line; flag that production needs a shared store
(Redis/edge KV) and a CAPTCHA (hCaptcha/Turnstile) — in-memory is per-process.

```ts
const rl = checkPublicRateLimit(clientIpFrom(request))   // x-nf-client-connection-ip → x-forwarded-for
if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' },
  { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } })
```

## 3. A post-auth redirect must be validated same-origin

A `returnTo`/`continue` param — especially one carried in an **unsigned** OAuth
state — is attacker-controlled. `startsWith('/')` passes `//attacker.com/x`
(protocol-relative), which the browser follows OFF-SITE → phishing. Validate as a
clean same-origin path at **every** layer that consumes it (the callback AND any
page that does `router.replace(continue)` — that page is reachable directly):

```ts
export function safeInternalPath(v: string | null | undefined, fallback = '/'): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || /[\\\t\n]/.test(v)) return fallback
  try { const u = new URL(v, 'https://internal.invalid')
        return u.origin === 'https://internal.invalid' ? u.pathname + u.search + u.hash : fallback }
  catch { return fallback }
}
```

## 4. Sign OAuth state; verify webhooks; redact secrets

- **Sign the OAuth state.** HMAC the `{tenant_id, returnTo, nonce}` and verify on
  the callback. An unsigned state is fine while single-tenant, but the instant a
  clone goes multi-tenant, a state-borne `tenant_id` becomes a connect-to-victim
  hijack vector. Sign from the start so you never have to retrofit it. Never take
  a tenant id from a request and trust it (hard rule 9).
- **Verify webhook signatures** over the RAW body, constant-time, BEFORE any DB
  work; no secret configured ⇒ refuse (503), never accept. See exsto-external-api.
- **Redact secrets** from any third-party error text before it is logged or
  stored in a client-readable column (e.g. a connection's `last_error`). Today's
  SDKs build error messages from the response body, not the request header — but
  scrub the resolved key + token-like shapes (`sk-`,`pplx-`,`AIza`,`ya29.`,…) so
  it holds by construction.

## The rule of thumb

For every public edge, ask: *who is the actor, what can they reach, how often,
and where does their input flow?* If the answer to "what can they reach" is "the
whole registry," or to "how often" is "unbounded," or their input becomes a URL /
SQL identifier / prompt that drives an action, you have a finding. The substrate
won't catch it — this is the layer you own.

## Pointers to ground truth

- Legal clone fixes: `verticals/legal/src/mcp/clientPolicy.ts` (allowlist),
  `apps/legal-demo/lib/rateLimit.ts` + `lib/safeRedirect.ts`, the client/mcp +
  google/callback routes, `tests/.../client-portal-policy.test.ts` +
  `public-route-hardening.test.ts`.
- exsto-external-api (consuming external services: raw-first, webhook verify,
  Vault), exsto-verify-tenancy (prove isolation on the DB), exsto-rest-api (the
  authenticated REST sibling + its per-principal limiter), ADR 0024/0038.

## Verify

For each public route, prove the boundary holds — don't assert it:

```
# allowlist: an attorney-only tool is unreachable from the public route
curl -s -X POST <host>/api/<public>/mcp -d '{"toolName":"legal.settings.update","input":{}}'  # → 404
# rate limit: the (N+1)th request in the window is rejected
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " -X POST <host>/api/<public>/mcp \
  -d '{"toolName":"legal.service.list"}'; done   # → trailing 429s
# open redirect: an off-site continue is neutralized
curl -si "<host>/auth/complete?continue=//evil.com" | grep -i location   # → never evil.com
```

And a unit test per helper (`safeInternalPath` rejects `//host`/`\`/schemes;
the allowlist excludes every write/admin tool) so the boundary is regression-proof.
