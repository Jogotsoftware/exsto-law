# Branded HTML email kit (`@exsto/legal` → `src/email/`)

Transactional email designs for Pacheco Law — navy + gold "Trust & Authority"
brand, matching the app. `renderEmailHtml(ref, vars) → { subject, html, text }`
is a pure function (no DB, no network) the send paths call to brand outbound mail.

## Wired in (live)

Outbound client mail is now **multipart/alternative** (branded HTML + plaintext
fallback), wired through two seams:

- **Notification engine** — `api/notifications.ts` `deliverNotification()` calls
  `renderEmailHtml(ref, variables)` and passes the HTML to the email driver. The
  `ref` keys here mirror the `notification_route_definition.template_ref` values,
  so routed notifications are branded automatically; a ref with no kit template
  falls back to plaintext (unchanged behaviour).
- **Contract B** — `api/mailWorkspace.ts` `enqueueClientEmail()` accepts an
  optional `html` part, threaded into `adapters/gmail.ts` `buildRawMessage()`
  (which composes text/plain + text/html, and nests inside multipart/mixed when
  attachments are present). `api/billing.ts` `sendInvoice()` uses this to deliver
  the branded `client-invoice` email.

Plaintext is **always** sent as the fallback part — no client is left without a
readable body.

## Templates

Keyed by `ref` (mirrors the notification `template_ref`s, plus client-facing
types). Money is decimal strings (ADR 0043/0044) — `client-invoice` formats them
without float math.

`prospect-booking-confirmation`, `appointment-reminder`, `prospect-intake-confirmation`,
`client-document-ready`, `client-invoice`, `client-portal-magic-link`,
`client-portal-message`, `attorney-draft-completed`, `attorney-manual-matter`,
`attorney-portal-message`.

The `appointment-reminder`, `client-document-ready`, and `client-invoice` types
have no `notification_route_definition` row yet — `client-invoice` is rendered
directly by `sendInvoice`; the other two await their routes (S3 comms).

## Preview

```
npx tsx verticals/legal/src/email/preview.ts
open verticals/legal/src/email/previews/index.html
```

The sample data in `preview.ts` is the canonical variable contract per template.
