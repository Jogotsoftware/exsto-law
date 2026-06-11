---
name: exsto-external-api
description: Consume an EXTERNAL service (webhooks, polled APIs, OAuth providers) into Exsto the substrate way — raw payloads into raw_event_log with typed provenance, worker-run idempotent projection through the action layer, verified signatures, server-side tenant resolution, secrets in Vault. ALWAYS consult this when integrating a third-party API (calendar, mail, transcription, payments), adding a webhook receiver, writing a polling job, or whenever external data needs to become substrate facts. (To EXPOSE Exsto over HTTP, see exsto-rest-api instead.)
---

# Consuming external services

External data is hearsay until the substrate can answer: what arrived, from
whom, when, and what did we derive from it? The discipline: **store the raw
payload first (append-only), project it through the action layer in a worker,
idempotently, with typed provenance** — never trust the payload to tell you
whose data it is. The exsto-law clone's Granola/Google integrations are the
reference implementations; file paths below point there.

## The pipeline (reference: Granola call ingestion)

```
webhook (thin, signature-verified, fast-ack)
  → submitAction('raw_event.ingest')      raw payload → raw_event_log (invariant 14)
  → enqueueJob('<vertical>.project')      worker_job queue
worker:
  → normalize / fetch via the provider API (key from Vault)
  → resolve the TARGET (e.g. match a matter) server-side
  → submitAction('<domain>.ingest')        projection: entities + relationships
                                           + events, provenance integration:<provider>
```

Reference files (exsto-law):

- Webhook receiver: `apps/legal-demo/app/api/webhooks/granola/route.ts` — reads
  the RAW body, verifies HMAC, returns fast; all heavy work is queued.
- Pipeline orchestration: `verticals/legal/src/api/granolaIngestion.ts` —
  `handleGranolaWebhook` (verify → raw_event.ingest → enqueue),
  `runGranolaProjection` (worker side), `matchMatterForCall` (server-side
  target resolution).
- Provider adapter: `verticals/legal/src/adapters/granola.ts` —
  `verifyGranolaSignature` (HMAC-SHA256, constant-time compare),
  `normalizeGranolaPayload` (defensive shape handling), `fetchGranolaCall`.
- Idempotent projection handler: `verticals/legal/src/handlers/call.ts`
  (`call.ingest`) — dedupes on the stable external id before writing anything.
- OAuth provider (Google Calendar/Gmail): `verticals/legal/src/adapters/
  googleCalendar.ts` + `gmail.ts`; mail projection `handlers/mail.ts`
  (`mail.ingest`/`mail.send`) — idempotent on Gmail thread/message ids,
  provenance `integration:gmail`.

## The rules

1. **Raw first, always.** Every inbound payload lands in `raw_event_log` via the
   `raw_event.ingest` action before any interpretation (invariant 13/14). The
   projection can be replayed; the raw record cannot be reconstructed later.
2. **Typed provenance.** Every projected fact carries
   `source_type='integration'`, `source_ref='integration:<provider>'` (or
   `<provider>:<external-id>`). Never `human`, never blank (invariant 5).
3. **Worker-run, idempotent on stable external ids.** Webhooks redeliver and
   pollers overlap; the projection must dedupe on the provider's id (Granola
   call id, Gmail message id) BEFORE writing. Retries are then safe — the
   worker runtime's backoff/dead-letter handles transient provider failures.
4. **Verify webhook signatures** over the RAW body with a constant-time
   compare; reject before touching the database. No signature secret configured
   = refuse (503), never "accept for now".
5. **Tenant is resolved server-side.** A webhook payload claiming a tenant id is
   attacker-controlled input. Resolve from your own state (the registered
   webhook's owner, the connection row, a server-side constant for single-tenant
   phases) — `granolaIngestion.ts` hardcodes this rule.
6. **Secrets in Vault, metadata in the connection row.** API keys and OAuth
   tokens go through the Vault-backed store
   (`verticals/legal/src/adapters/connectionStore.ts`); the queryable row
   (`legal_integration_connection`) carries status/account/expiry/last_error
   ONLY. Failures flip status to `error` so the UI shows a broken sync
   prominently — never silently fall back.
7. **No parallel CRUD layer.** The projection writes through `submitAction`
   like every other client (hard rule 1/9). An integration is just another
   actor with provenance.
8. **Unmatched data goes to a review queue, never the void.** If target
   resolution fails, project WITHOUT the link and surface it (exsto-law:
   call_sessions with no `call_of` relationship). Wrong-target attachment is
   usually worse than unmatched — prefer strict matching.

## Local development

Webhooks can't reach localhost. Keep a stub driver behind the SAME interface
(`buildStubCallSession` → identical raw_event.ingest → projection path) and/or
tunnel (`ngrok`/`cloudflared`). Stub assumptions must not leak into callers —
the production path and the stub differ only at the entry point.

## Gotchas

- **`gh`-style "fire and forget" enqueue inside the webhook handler is the only
  slow-path allowed**: one raw insert + one job insert, then 200. Provider
  retry windows are short.
- **Don't fetch-then-store.** Store the webhook payload as received; fetch
  enrichments in the worker. If the fetch fails, the raw record still exists.
- **Polling drivers** are the same pipeline minus the signature step: poll →
  raw_event.ingest (dedupe on external id) → same projection job.

## Pointers to ground truth

- exsto-law: `verticals/legal/src/api/granolaIngestion.ts`,
  `src/adapters/{granola,googleCalendar,gmail,connectionStore}.ts`,
  `src/handlers/{call,mail}.ts`, `apps/legal-demo/app/api/webhooks/granola/route.ts`.
- Foundation: `packages/primitives/src/handlers/ingestion.ts`
  (`raw_event.ingest`, `source_record.link`), ADR 0027 (worker runtime),
  invariants 5/13/14; `exsto-verify-tenancy` for the post-change audit.

## Verify

After wiring an integration, prove the discipline on the live DB:

```sql
-- (a) every projected fact traces to a raw record and typed provenance
SELECT count(*) FROM raw_event_log WHERE source_ref = 'integration:<provider>';
SELECT DISTINCT source_type, source_ref FROM attribute
 WHERE source_ref LIKE '%<provider>%';        -- integration:<provider> only

-- (b) replay safety: redeliver the same webhook/external id — row counts
--     unchanged (run the redelivery, then re-count)
```

And the signature check: a tampered body or missing signature returns 401
without any database write.
