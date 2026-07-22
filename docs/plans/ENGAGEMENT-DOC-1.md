# ENGAGEMENT-DOC-1 — attorney-uploaded engagement agreement, signed in the portal

Founder ask (2026-07-21): the engagement agreement goes live. The attorney uploads
their real engagement letter as a PDF in settings; the system parses it for
details, templatizes it (client name / company become merge fields), and the
client portal shows the FULL merged document for the client to sign and agree
to. Example doc: `Engagement Letter_Mi Rey LLC_2026.pdf` (Pacheco Law · Mi Rey
LLC · Outside GC · $350/450 rates · $3,500 retainer · firm signs first, client
countersigns an Acceptance-of-Terms block).

Founder decisions (asked + answered this session):
1. **Parse into merge template** — not PDF-overlay. The letter's text becomes a
   document template with real merge fields; house doc rendering, editable in
   the template editor afterward.
2. **Gate shows BOTH** — the full agreement to sign AND the existing short
   text-terms acceptance stays. Two acknowledgments, one gate flow.
3. **Firm pre-signs** — the merged agreement renders with the attorney's
   signature already applied (like the example letter); the client's signature
   is the only live signing step.

## What already exists (reuse, do not rebuild)

- `pdf-parse` dep in apps/legal-demo AND verticals/legal — PDF text extraction.
- `verticals/legal/src/api/standaloneTemplates.ts` — createTemplate /
  updateTemplate / aiDraftTemplate / aiEnhanceTemplate (Claude adapter inside).
- `templateMerge.ts` — renderTemplate / buildMergeData / longDate; honest
  `[[MISSING: field]]` slots; MERGE_SLOT_FIELDS.
- `template_esign_config` attribute (0187, applied to prod 2026-07-21):
  roles [{key,label,recipientRole,bind,order}]; binds incl. `manual`.
- Native e-sign loop: fields.ts/esign.ts/esignRender.ts/handlers/esign.ts —
  signature capture, stamping (rotation-safe #465), executed copies, envelopes
  (#468 multidoc), compact tokens (#467).
- Engagement gate: `verticals/legal/src/api/engagement.ts`
  (getEngagementConfig/Status, accept/decline, assertEngagementAccepted,
  setEngagementTerms w/ terms_version) + `EngagementGateModal` in
  `apps/legal-demo/app/portal/page.tsx` (~L880) + FeeConsentCard.
  clientTool `legal.client.engagement`.
- Settings surface: `apps/legal-demo/app/attorney/settings/firm/` (engagement
  terms already live here) — upload card goes here.
- RBAC: client.portal allowlist NOW includes engagement.accept/decline +
  confirm_portal_email on all 4 tenants (amended 2026-07-21 via
  permission_scope.amend, see verticals/legal/demo/n1-allowlist-amend.ts).

## Phases

### P1 — substrate (migration 0189; number above main AND prod, both at 0188)
- Attribute kind `engagement_template_id` on firm_settings — the pointer to THE
  firm engagement-agreement template. Fresh id block, ON CONFLICT DO NOTHING,
  all-tenant copies (mirror 0188's pattern).
- Action kind `legal.firm.set_engagement_template` (mirror
  legal.firm.set_engagement_terms; reversible; intent config change). Handler in
  verticals/legal/src/handlers/ + API in api/engagement.ts.
- NO new event kind for acceptance: `engagement.accepted` payload is free-form —
  extend with `{agreement_document_id, agreement_template_id, template_version}`.

### P2 — parse pipeline (server)
- `POST /api/attorney/settings/engagement-agreement` (multipart PDF):
  1. pdf-parse → raw text.
  2. Claude adapter (respect LEGAL_DRAFTING_MODEL config — empty-not-unset
     gotcha): produce (a) template BODY in house template format with merge
     fields for client entity name, signer name, signer title, client address,
     client email, date; keep firm constants (rates, retainer, firm address)
     as literal text; preserve full Terms of Engagement text; (b) parsed
     details JSON {hourly_rate, litigation_rate, retainer, firm_address,
     attorney_name} for the settings summary; (c) attorney signature block
     rendered pre-signed (script-font name style, see P4).
  3. createTemplate (standaloneTemplates) with template_esign_config:
     roles = [{key:'client', label from signer block, recipientRole:
     'needs_to_sign', bind:'manual', order:1}]. Attorney is NOT a signing
     role (pre-signed per founder decision).
  4. Fire legal.firm.set_engagement_template {template_id, details}.
- Re-upload replaces: new template + pointer update (old template retires via
  retireTemplate).

### P3 — settings UI (attorney/settings/firm)
- "Engagement agreement" card: state none → upload; state set → template name,
  parsed details summary (rates/retainer), "Open in template editor" link,
  Replace / Remove. Reuse SettingsAlert/shared.tsx idioms. lucide icons only.

### P4 — portal gate (client)
- Extend `legal.client.engagement` tool + EngagementGateModal: when
  engagement_template_id set → fetch merged agreement HTML (renderTemplate +
  buildMergeData from the client contact: name, company = client_contact
  org/company field — verify actual field name; email; longDate(today)),
  render full-document scroll view above the existing FeeConsentCard
  (text-terms accept stays — decision 2).
- Client signature: reuse the native e-sign SignatureCapture (draw/type).
  Submit → server: generate executed PDF via esignRender pipeline (stamp
  client signature + date; attorney block already in body), record document
  (client-visible; engagement is firm-level/pre-matter — attach to the client
  contact the way client uploads are, NOT to a matter; verify the #347
  client-wide documents seam), then acceptEngagement with extended payload.
- assertEngagementAccepted is unchanged (acceptance event is still the gate
  fact). Fallback when no template set: current behavior exactly.

### P5 — receipts
- Unit: parse-route contract (mock adapter), merged render includes client
  name + no [[MISSING]] for a complete contact, gate handler records
  document + accept in order, RBAC negative (client can't set template).
- Prod walk script `verticals/legal/demo/engagement-doc-receipts.ts`:
  upload Mi Rey example → template created + pointer set → merged render for
  founder contact → sign → executed doc + accepted event with document id.
- pnpm format && lint && typecheck && build + test:unit (explicit-list gotcha:
  new test files must be added to the test:unit list if it's an explicit list).

## Hazards
- Tenant-zero hardcodes = 2nd-firm hazard: resolve firm/tenant per-request,
  never PUBLIC_INTAKE_ACTOR-style constants. Pacheco (ae5530a1) is the firm
  that will actually use this.
- FIRM_DEFAULTS must never reach document merge (template autobind lesson).
- globals.css is a hot file — append-only, next build after any merge.
- CI never runs next build; Netlify deploy-preview does — treat it as the gate.
- Migration numbering: check `git ls-tree origin/main supabase/migrations_vertical/`
  AND prod `private.vertical_migration` before finalizing 0189.
