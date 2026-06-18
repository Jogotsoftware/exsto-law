# E-signature (native, substrate sign-by-link)

E-signature is rebuilt **natively in the substrate** (the 2026-06-17 "rebuild
within" decision): no external host, **no recurring cost**, OpenSign/DocuSign
used only as flow references (AGPL — no source vendored). Signing is a sign-by-
link flow modeled entirely on the substrate's own primitives.

## How it works

1. **Send** (attorney): the `legal.esign.send_for_signature` tool (beside the
   draft-link email) runs `esign.send` — creating a `signature_envelope` linked
   `envelope_of` → the document, one `signature_request` per signer — then mints
   a per-signer HMAC **signing token** and emails each signer their secure link
   (`/sign/<token>`) via the `esign_sign_request` notification route. `esign.sent`
   is recorded.
2. **Sign** (signer): the link opens the public sign page (`/sign/[token]`,
   no login — the token is the email-bound auth, like the client-portal magic
   link). The signer reviews the document, types their name, accepts the
   ESIGN/UETA consent, and signs → `esign.sign` → `esign.signed`.
3. **Complete**: when the last signer signs, the envelope completes
   (`esign.completed`) and the **executed copy** — the original markdown plus a
   signature certificate (each signer, timestamp, consent) with the **original
   content's SHA-256** embedded as tamper-evidence — is written as a new
   immutable `document_version` (invariant 14). The original version is untouched.
   A signer may instead **decline** → `esign.decline` → `esign.declined`.

Every transition is an action through the operation core; the full audit trail
(actions + events + per-signer consent/signature attributes) lives in the substrate.

## Configuration (the only requirement)

- **`ESIGN_SIGNING_SECRET`** (≥16 chars) signs the signing-link tokens. Falls
  back to **`OAUTH_STATE_SECRET`** (already required in every deploy), so in
  practice nothing new is needed. Fail-closed: with no secret, sending refuses.
- `NEXT_PUBLIC_BASE_URL` / `URL` for absolute signing links (already set; same
  fallback as the client-auth routes).

No host to stand up, no credentials to store, no per-envelope cost.

## Provider seam (dormant)

The provider-agnostic `EsignDriver` interface (`verticals/legal/src/esign`) is
retained so an external provider (e.g. DocuSign) could be added later behind the
same seam — set `LEGAL_ESIGN_PROVIDER` and connect creds via the connection
store. The OpenSign driver + `/api/webhooks/esign` route remain as that dormant
external path; `native` is the default and the live path.

## UI surface

The attorney "Send for signature" action is exposed as the
`legal.esign.send_for_signature` MCP tool. The visible button on the review page
is a thin call to that tool (mirror `emailDraftLink` in
`apps/legal-demo/app/attorney/review/[versionId]/page.tsx`) — deferred to keep
this change additive; the backend, the public sign page, and the routes are fully
wired.
