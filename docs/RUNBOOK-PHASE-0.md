# exsto-law — Phase 0 Runbook

How to run the wedge locally for the demo, and what each moving part needs.
Supabase project: **exsto-law** (`jfcarzprfpoztxuqykoe`, us-east-1).

## Quickstart (REQ-DEMO-01)

```bash
pnpm install
pnpm build
pnpm seed:demo     # idempotent — detects the existing demo matter, never resets (append-only substrate)
pnpm preflight     # DB, migrations, vertical ledger, connections, keys, ports
pnpm dev:web       # Next.js app on :3000 (attorney app + booking portal)
pnpm dev:worker    # async drafting, notifications, Granola projection
```

- Attorney app: `http://localhost:3000/attorney?demo_user=juan-carlos`
- Public booking: `http://localhost:3000/book`
- `?demo_user=` is a dev-mode bypass, gated to `NODE_ENV !== 'production'` (REQ-DEMO-04).

## Environment (`.env.local`, gitignored)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | session-pooler owner URL — migrations/seed/scripts only (ADR 0037) |
| `SUBSTRATE_DB_ROLE=authenticated` | drops app/worker connections to the non-owner role so RLS is engaged |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | client config for the exsto-law project |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` | the firm's Google OAuth app (calendar, gmail) |
| `ANTHROPIC_API_KEY` | live drafting (worker); preflight warns when missing |
| `GRANOLA_API_KEY` / `GRANOLA_WEBHOOK_SECRET` | env fallback — the Settings UI stores these in Vault |
| `ATTORNEY_EMAIL` | optional override; defaults to the connected Google account |
| `NEXT_PUBLIC_BASE_URL` | deep links in calendar events + notification emails |

Secrets for integrations connected through **Settings** live in Supabase **Vault**
(`legal_integration_connection` holds metadata only — REQ-SEC-01).

## Integrations (one-click, no developer steps — REQ-CALMAIL-04)

- **Google** — Settings → Connect Google (calendar scope; offline consent).
  The Mail tab requests `gmail.readonly` incrementally on first use ("Enable Mail").
  Connection health is visible; failures flip the card to **error** with the reason.
- **Granola** — Settings → Connect Granola (API key → Vault). Webhook endpoint:
  `POST /api/webhooks/granola` (HMAC-SHA256 over the raw body; header
  `x-granola-signature`). Tenant is resolved server-side, never from the payload.

## Local-dev webhook fallback

Granola webhooks can't reach `localhost`. The same projection pipeline runs
from either entry:

1. **Stub driver** — "Simulate consultation call" on a matter (or the demo seed)
   pushes a stub payload through `raw_event.ingest → call.ingest` — identical
   shape to production.
2. **Tunnel** — point the Granola webhook at an `ngrok`/`cloudflared` tunnel to
   `:3000/api/webhooks/granola` to exercise the real receiver.

## Async pipeline

`worker_job` queue (SKIP LOCKED, backoff, dead-letter). Job kinds:
`legal.granola.project` (webhook → call_session/transcript, idempotent on the
Granola call id), `legal.draft.run` (Claude drafting + reasoning trace; emits
`draft.failed` on non-retryable preconditions), `legal.notify` (route → Gmail
driver → `notification.send` action). The worker must be running for drafts
and emails to move.

## Verification

```bash
SUBSTRATE_TEST_DATABASE_URL=<owner url> pnpm test    # invariants (33) + vertical suite
```

"Done" is a database query (Lesson #8): every workflow step must be visible as
an action row — see `legal.matter.history` on any matter.
