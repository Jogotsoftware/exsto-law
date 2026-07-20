# ESIGN-UNIFY-1 — Design (exsto-law)

(Architecture pass for the e-signature overhaul. Binding inputs: founder product-walk spec
2026-07-20 — ITEM 10 E1–E9, ITEM 15 items 15.5–15.8, 15.16–15.18, 15.20, 15.24, ITEM 16 Phase 1
ES-1..ES-6. The DocuSign comp (15.18, 4 screenshots) is the functional spec for the placement
surface; the UI is the app's own Legal Instruments navy/gold + Public Sans + lucide language —
same functionality, NOT a visual clone. This doc is what the implementation agents build from.
Docs-only PR; no application code changes here; migrations are PLANNED here, not applied.)

## 0. Verdict

Two divergent send flows exist and NEITHER has visual field placement (15.16 corrected the plan's
old assumption — the native flow's "Fields" step is an anchor-tag TEXT editor showing raw
markdown). Both flows die at a fake preview, recipients have no roles, pickers are dumb selects,
and templates can't carry signature layout. The overhaul: **one composer, one placement model,
one envelope set** — a single `EsignComposer` wizard launched from every entry point, a real-PDF
placement canvas (the flagship), a `FieldPlacement` storage model that carries BOTH
template-derived anchors and free-placed coordinates, template-embedded signature config that the
service-builder AI can author (the gating item 15.20), and a workflow e-sign step that makes the
common case zero-setup. Button label everywhere: **"eSign"**.

## 1. Ground truth (audited on `origin/main` @ 51030b5)

What exists, verbatim from code — build on this, not around it:

- **Envelope model** (migrations 0043/0044, all config-as-data): entity kinds
  `signature_envelope` (`…1010-…00e1`) + `signature_request` (`…1010-…00e2`); envelope attrs
  `envelope_status` (pending_dispatch|sent|completed|declined), `envelope_subject`,
  `envelope_fields` (json field plan); per-signer attrs `signer_email/name/status/consent`,
  `signature_data`, `signer_key/title/order/channel` ('portal'|'link'), `field_values`;
  relationships `envelope_of` (→ document), `request_of`, `document_of_contact` (0173);
  actions `esign.send/sign/decline/open`; events `esign.sent/delivered/opened/signed/completed/
  declined` (+ `esign.voided` 0167). Sequential routing: lowest-order pending group is delivered
  next (`verticals/legal/src/handlers/esign.ts:865-882`); same order = parallel. **No role field
  anywhere** — `SendSigner = { email, name?, key?, title?, order?, channel?, signer_provider_ref? }`
  (`handlers/esign.ts:42-50`).
- **Anchor grammar — ONE system**: `verticals/legal/src/esign/fields.ts` owns
  `MARKER_TYPE_PATTERN = 'sign|initial|name|date|title|text|check'` and the `{{type:signerKey}}`
  tag regex; SIG-BLOCK-1 (`esign/executionBlock.ts`, #426) imports the same pattern —
  `buildExecutionBlock()` emits the canonical execution section
  (`**Accepted and Agreed:**` + `{{sign:key}}` / `Name: **…**` or `{{name:key}}` /
  optional `Title:` / `{{date:key}}`), `renderSigMarkersForPreview()` renders markers as ruled
  `div.sig-line` HTML, `classifyExecutionLine()` is shared with the react-pdf renderer
  (`verticals/legal/src/render/draftPdf.ts:203-239` draws the ruled lines). `AUTO_FIELD_TYPES =
  ['name','date']` already auto-fill at sign time. Merge tokens (`{{token}}`, no colon,
  `api/templateMerge.ts:20`) are a disjoint grammar — no collision.
- **Native flow** `apps/legal-demo/components/PrepareSignature.tsx`: 4-step wizard
  (Document→Signers→Fields→Review). Fields step inserts literal `{{sign:client}}` text into the
  markdown source pane (line ~112, ~348) — the founder-rejected plumbing leak (15.16). DELETE
  target.
- **Any-PDF flow** `apps/legal-demo/components/NewEnvelopeWizard.tsx` +
  `app/attorney/esign/new/page.tsx`: 3 steps (Document→Recipients→Review); matter/contact
  "Attach to" pickers are plain `<select>`s (lines 280, 291 — 15.5); recipients don't pre-fill
  from the attached contact (15.6); NO field placement (15.7); no message field; upload via
  `POST /api/attorney/esign/upload` then MCP `legal.esign.send_file`
  (`verticals/legal/src/api/esignFile.ts` — subject default `"Signature requested: <file>"`,
  line 116, a walk complaint). DELETE target.
- **Fake preview** `app/attorney/esign/[envelopeId]/page.tsx:354-370`: synthetic DocumentSheet
  card — canned sentence + gold `SIGN HERE` chip (15.8). DELETE target.
- **Signer screen** `apps/legal-demo/components/SignDocument.tsx`: adopt-signature capture is
  GOOD (Type with 3 cursive styles rasterized to data-URL, Draw pad, ESIGN/UETA consent,
  image-or-typed via `SIGNATURE_IMAGE_DATA_URL_RE`) — KEEP the capture, replace the document
  rendering (markdown `renderDocumentHtml` for drafts; inline file embed for PDFs; no field
  overlay UI).
- **PDF capability**: `@react-pdf/renderer` ^4.3.0 (generation only — drafts/invoices). There is
  **NO client-side PDF rasterization anywhere** (no pdfjs-dist, no pdf-lib). The placement canvas,
  the real preview, and the signer overlay all need pages on screen → **add `pdfjs-dist`**; the
  executed-PDF stamping needs **`pdf-lib`** (server). See §5.4.
- **Templates**: two stores. (a) Service-bound = pure config at
  `workflow_definition.transitions.document_templates.templates[docKind]`
  (`api/services.ts:1452-1505`; config wins → bundled repo body → none). (b) Standalone library =
  `template` entity (migration 0023; attrs `template_name/category/body/doc_kind` +
  `template_variables` 0076) + **`template_signature` json attr** `{ required, signer_roles:
  ('client'|'attorney'|'witness'|'notary')[] }` — the ESIGN-BLOCK-1 signable declaration, seeded
  via runtime `kind.define` (`demo/seed-template-signature-kind.ts`), NOT yet a migration row.
  Editors: `components/TemplateEditorModal.tsx` + `components/templates/TemplateEditor.tsx`
  (TipTap; `SignatureLineNode.ts` already renders sig lines) + `TemplateFieldsPanel.tsx`.
  AI authoring seam (#308 pattern): `api/templateAuthoring.ts` — `loadTemplateContext` /
  `validateProposedTemplate` (orphan-token report) / `createTemplateAI` (trace-first agent write).
- **Merge/autobind seam** (#282-285): `api/templateMerge.ts` — `buildMergeData()` maps matter
  facts + questionnaire answers + firm identity into `MERGE_SLOT_FIELDS` (client_name,
  client_email, company_name, governing_jurisdiction, attorney_name, …); missing renders
  `[[MISSING: field]]`, never guessed. `api/tokenClasses.ts` classifies CLIENT/ATTORNEY/SYSTEM;
  editor chips color blue=matched / yellow=orphaned / red=unknown
  (`components/templates/TemplateVariableNode.ts:10-15`). **FIRM_DEFAULTS must never reach
  document merge** — `getTenantSettingsForMerge()` degrades to EMPTY
  (`api/tenantSettings.ts:244-264`). The placement data-autofill (§5.3) rides THIS seam.
- **Chat launch seam**: `api/esignLaunchTools.ts` — `prepare_envelope` ClientTool resolves a
  matter document by words, returns an `EnvelopePrepareLaunch` descriptor, writes nothing; the
  frontend opens the wizard (open_artifact_editor launch pattern). This IS the E8 mechanism —
  extend, don't reinvent. `mcp/tools/sendForSignature.ts` is the server send op for drafts.
- **Delivery**: routes `esign_sign_request` (0043) / `esign_sign_request_portal` (0044) →
  `api/notifications.ts deliverNotification()` → `renderEmailHtml(ref, vars)`
  (`src/email/templates.ts`). The branded BUILDERS map has **no esign entries** → signing emails
  fall back to plaintext (`api/notificationTemplates.ts:104-127`). The P0 investigation confirmed
  the pipeline itself DELIVERS (the walk failure was a wrong-contact pick between two same-name
  contacts); the portal-empty bug (15.12) was the `draft_of`-only INNER JOIN in
  `listClientSignatures` / `listClientDocuments` (`api/esign.ts:962/1031/1082`) excluding
  standalone envelopes — **fix PR in flight on branch `fix/portal-esign-visibility`; this design
  treats that triple-lane fix (`draft_of` | `document_of` | `document_of_contact`, mirroring
  `api/esign.ts:413-425`) as landed baseline.**
- **Migration conventions**: 4th UUID segment = table discriminator (1010 entity / 1011 attribute
  / 1012 relationship / 1013 action / 1014 event / 1016 outcome / 1020 workflow / 1030
  notification route); collision lanes live in the trailing segment (0169 used lane `2000`,
  0170-0183 used `21xx/22xx/3000`). Kinds seed tenant-zero; `cp_sync_all_tenant_vocab()` (0174)
  replays them to every tenant after each `migrate:vertical`; recent migrations (0180) ALSO carry
  explicit all-tenant catch-up loops. Frontier on main: 0184.

## 2. Architecture — one composer, one placement model, one envelope set

```
entry points ──────────────┐
 eSign page  "eSign"       │
 matter/doc actions "eSign"│──▶ EsignComposer (modal wizard)
 review surface "eSign"    │      1 Documents   2 Recipients   3 Fields   4 Review & send
 workflow e-sign step      │            │              │            │           │
 chat prepare_envelope ────┘            │              │            │           ▼
                                        │              │            │      esign.send (one action)
 document sources                       │              │            │           │
  • uploaded PDF(s) ── real bytes ──────┤              │            │           ├─ email leg (branded 15.24)
  • document_version ─ server-rendered ─┘              │            │           ├─ portal leg (Signatures tab)
    PDF + marker→rect map                              │            │           └─ events/timeline
 template esign config ──▶ pre-resolved roles ─────────┘            │
 (0187) role-tagged blocks ──▶ pre-placed FieldPlacements ──────────┘
```

Principles (each resolves a walk finding):
1. **Placement always happens on the real rendered PDF** (15.8/15.16/15.18). For uploaded PDFs,
   the uploaded bytes; for drafts, the platform's own react-pdf render of the version being sent.
   One visual truth: what you place on is byte-identical to what the signer sees and what gets
   stamped.
2. **Anchors author, coordinates execute** (§5). Templates and generated markdown carry
   `{{type:key}}` markers (attorneys never see them — 15.16b); the envelope stores resolved
   rect placements; the bridge is a marker→rect map emitted by the PDF renderer.
3. **Roles are recipient facts, not code paths** (E4): `needs_to_sign` / `needs_to_view` /
   `receives_copy` as a `signer_role` attribute; one send handler branches on it.
4. **No draft envelopes.** The workflow step and the composer assemble the envelope in memory
   and submit ONE `esign.send` when the attorney confirms — append-only stays clean, no
   placement-edit action kinds needed.
5. **No zombie paths**: the cutover PR that flips entry points DELETES PrepareSignature.tsx,
   NewEnvelopeWizard.tsx, and the fake preview in the same diff (§12, ES-5).

## 3. The unified send wizard — `EsignComposer` (ES-1)

New component family `apps/legal-demo/components/esign/` (new dir; new append-only `li-esign2-*`
CSS family in `app/globals.css`, `css:check` before every push):

- `EsignComposer.tsx` — the ONE wizard. Full-screen modal (WP-M `Modal` size wide precedent),
  4 steps: **Documents → Recipients → Fields → Review & send**. Props:
  `{ source: ComposerSource, onClose, onSent }` where
  `ComposerSource = { kind: 'blank' } | { kind: 'upload', file? } | { kind: 'document',
  documentEntityId, documentVersionId, matterEntityId? } | { kind: 'workflow-step', … (§7) }`.
- `useEnvelopeDraft.ts` — composer state: documents[], recipients[], placements[], message,
  subject, attach (matter/contact), derived validation per step.

**Step 1 — Documents.** Doc cards with first-page thumbnail (pdfjs, §5.4) + name + page count +
kebab (remove/replace); drop-zone + Upload (reuses `/api/attorney/esign/upload`); when launched
from a document/matter context the document arrives pre-attached. Multi-document envelopes are
IN scope for the card UI but v1 send keeps one document per envelope (the envelope model is
1 doc via `envelope_of`); the card list enforces max 1 with a clear "coming soon" affordance
REMOVED — instead: single-slot card UI, no fake multi. (DocuSign screen 1 parity is the
collapsible section layout, not multi-doc.)
"Attach to" moves here: the cross-filtered pickers (below).

**Step 2 — Recipients.** Numbered rows, each with the signer's color edge (§4 palette), Name
(contact typeahead — reuses the existing `li-esign-suggest` CRM typeahead) + Email + Title,
per-recipient **role dropdown**: "Needs to sign" (default) / "Needs to view" / "Receives a copy"
(E4). **Drag reorder** (HTML5 DnD, same pattern as the workflow step editor #311) rewrites the
existing `order` field; a "Set signing order" toggle — OFF collapses all orders to 1 (parallel,
already supported by `deliverNextGroup`). "Add Recipient". Pre-fill (15.6): attached contact →
row 1 name/email(/title); attached matter → its primary contact the same way; rows stay editable/
removable. New-recipient emails save as contacts on send (existing `save_signers_as_contacts`).

**Cross-filtered matter/contact pickers (15.5)** — new
`components/esign/MatterContactPicker.tsx` built ON `components/Combobox.tsx` (typeahead
single-select, built for exactly this):
(a) matter picked → contact options narrow to that matter's contacts;
(b) contact picked → matter options narrow to that contact's matters;
(c) clearing one restores the other's full list.
Data: existing list endpoints (`legal.matter.list` / contacts list) + the matter⇄contact
relationships; filtering client-side over the already-fetched lists (both lists are small
per-tenant; no new MCP tool). Export the pair as a reusable component — the plan file says reuse
it "anywhere else a matter+contact pair is picked". Picker queries EXCLUDE archived contacts
(the "MT1 Acceptance" residue fix rides the PO-6 archive, but the filter is belt-and-braces).

**Step 3 — Fields.** The placement surface (§4).

**Step 4 — Review & send.** Real first-page preview (same `PdfCanvas`, read-only, fields
overlaid), subject (default = document title, NO "Signature requested:" prefix — kill
`esignFile.ts:116`), **Add message** textarea (new `envelope_message` attr, 0186 — flows into
the 15.24 email), recipient summary with role chips, ESIGN/UETA consent line, **Send** (gold).
Send path: upload (if file) → ONE send call (§5.5) → success pane links to the envelope detail.

## 4. The placement surface — flagship (ES-2)

DocuSign comp 15.18, rebuilt in LI language. Layout (three-pane, inside the composer's Fields
step):

- **Left rail — searchable field palette** (`FieldPalette.tsx`): search box; lucide-icon chips
  (E6): Signature (`signature` icon, gold accent — the marquee chip), Initials (`type`),
  Date signed (`calendar-check`), Name (`user`), Email (`at-sign`), Company (`building-2`),
  Title (`briefcase`), Phone (`phone`), Address (`map-pin`), Text (`text-cursor-input`),
  Checkbox (`square-check`). Drag a chip onto the page → a `FieldBox` at the drop point.
- **Center — the document** (`PdfCanvas.tsx`): real rendered pages (pdfjs-dist), vertical scroll,
  zoom control (fit-width / 100% / 150%), undo/redo of placement edits (local state stack).
  `FieldBox.tsx`: absolutely-positioned overlay per placement, signer-colored fill/border,
  drag to move, 8-handle resize, click to select → properties; Delete key / kebab removes.
- **Top bar — signer switcher** (`SignerSwitcher.tsx`): dropdown of `needs_to_sign` recipients
  (color dot + name); new placements belong to the active signer; switching re-tints nothing —
  every signer's boxes stay visible, active signer's are full-opacity, others dimmed (DocuSign
  behavior, per the comp).
- **Right rail — page thumbnails** (`PageThumbs.tsx`): pdfjs thumbnail per page, click to jump,
  badge = field count on that page.
- **Properties panel** (`FieldProps.tsx`, docks under the palette when a box is selected):
  Required checkbox (default on for sign/initial, off for text/check), Label (caption shown to
  the signer), signer re-assign dropdown.
- **Preview mode**: toggle that hides editing chrome and shows the signer-facing render
  (per-signer, follows the switcher).

**Per-signer colors**: deterministic palette of 8, assigned by recipient index, as CSS tokens in
the `li-esign2` family — `--li-esign2-s1: #1e3a8a` (navy), `--li-esign2-s2: #b45309` (gold),
`--li-esign2-s3: #0f766e` (teal), `--li-esign2-s4: #7c3aed` (violet), `--li-esign2-s5: #be185d`
(magenta), `--li-esign2-s6: #4d7c0f` (olive), `--li-esign2-s7: #b91c1c` (red), `--li-esign2-s8:
#475569` (slate). Box fill = color at 12% alpha, border solid; the recipient rows (step 2) and
the signer switcher use the same tokens.

**Auto-fill semantics** (15.7 + 15.18 data auto-fill):
- `date` fields are placed by the sender but **auto-fill with the actual signing date at the
  moment each signer signs** — the sender never types a date (extends the existing
  `AUTO_FIELD_TYPES` behavior; the signer view renders them as "(auto — date signed)").
- Data-bound fields (`name`, `email`, `company`, `phone`, `address`, `title`) **auto-populate at
  send time** from the bound contact/matter (§5.3). Populated boxes show the resolved value in
  the canvas immediately (the sender sees real data, comp's key line). Unresolvable → the box
  falls back to signer-fillable text with its label, NEVER an invented value and NEVER a
  FIRM_DEFAULTS value.

**Template-derived pre-placement**: when the document came from a signable template/generated
draft, its `{{type:key}}` markers arrive as pre-placed boxes (anchor-sourced placements, §5.2)
— the attorney adjusts rather than builds (15.17a/15.18 "template-default placement pre-seeds
this surface").

## 5. Storage model — anchors + coordinates, one record

### 5.1 The decision

**Anchor markers remain the authoring/storage representation inside document BODIES and
templates; the ENVELOPE stores resolved coordinate placements; every placement keeps its anchor
provenance when it has one.** Rationale: markers survive regeneration/re-drafting and are what
generation + the AI can author (they're text); coordinates are what a canvas, a signer overlay,
and a PDF stamper need. Neither alone covers both template-derived and free-placed fields — the
record carries both.

```ts
// verticals/legal/src/esign/placements.ts (new; pure, like fields.ts)
export type PlacementFieldType =
  | 'sign' | 'initial' | 'name' | 'date' | 'title' | 'text' | 'check'   // existing grammar
  | 'email' | 'company' | 'phone' | 'address'                            // NEW data-bound types
export interface FieldPlacement {
  id: string            // 'p0', 'p1', … envelope-stable
  type: PlacementFieldType
  signerKey: string     // matches signature_request.signer_key
  required: boolean
  label?: string
  source: 'anchor' | 'placed'
  /** Present when source='anchor': which body marker produced this placement. */
  anchor?: { type: PlacementFieldType; key: string; occurrence: number }
  /** ALWAYS present: normalized page coords (0..1 of page width/height), y from top. */
  rect: { page: number; x: number; y: number; w: number; h: number }
}
```

Stored as the new `envelope_placements` json attribute on `signature_envelope` (0186).
`envelope_fields` (0044) is legacy-read only: old envelopes without placements keep rendering
through the current whole-line flow; new envelopes always write `envelope_placements`. Signer
values keep the existing `field_values` attribute, keyed by placement id.

The grammar extension (email|company|phone|address) lands in `fields.ts` `MARKER_TYPE_PATTERN` +
`EsignFieldType` + `LABELS` (single-sourced; `executionBlock.ts` and the parser follow
automatically). They join `AUTO_FIELD_TYPES` as send-time-resolved kinds (§5.3).

### 5.2 The anchor→rect bridge (marker map)

For drafts (markdown document_versions), the composer needs rects for pre-placed markers.
Extend `verticals/legal/src/render/draftPdf.ts`: while `renderSigRule()` draws each ruled line
it already knows the page and layout box — emit a **marker map**
`Array<{ anchor: {type,key,occurrence}, rect }` alongside the PDF bytes. New server route
`app/api/attorney/esign/render/route.ts`: `{ documentVersionId } → { pdf: bytes(base64|stream),
markers: MarkerMap }` (attorney-authed, reuses the exact export pipeline so placement PDF ≡
download PDF). The composer converts markers → anchor-sourced `FieldPlacement`s (default rect
sizes per type: sign 200×48, initial 96×40, date 128×32, data fields 200×28 — in PDF points,
normalized against the page box). Regeneration/version bump: re-render → re-derive anchor
placements by `(type,key,occurrence)`, keep free-placed ones by rect (they're page-stable
because the doc body changed ONLY if regenerated — in that case the composer flags moved/lost
anchors for review instead of silently guessing).

Uploaded PDFs have no markers: all placements are `source:'placed'`.

### 5.3 Data auto-fill resolution (send time)

New pure helper `verticals/legal/src/esign/placementData.ts`:
`resolvePlacementData(placements, { contact, matter, recipients }) → Record<placementId,
string|null>`. Sources, in order: the placement's signer's OWN recipient row (name/email/title
— a signer's `name` field fills with THEIR name, not the primary contact's), then the bound
contact entity (email/phone/address attrs), then matter facts via the SAME sources
`buildMergeData` uses (company_name from questionnaire/client, etc.). Resolved values are
written into the executed render AND shown in the canvas; nulls degrade to signer-fillable.
Hard rule carried over: this path reads `getTenantSettingsForMerge`-class sources only — a
FIRM_DEFAULTS identity value must never appear in a placement (same forgery logic as
`tenantSettings.ts:244-252`).

### 5.4 Rendering dependencies (decision)

- **`pdfjs-dist` (pin ^4.x)** in `apps/legal-demo` only — client-side page rasterization for the
  canvas, thumbnails, review preview, envelope detail, and the signer overlay. Worker file
  bundled as a static asset (`next.config.mjs` copy or `?url` import) — NO CDN (CSP + offline
  discipline). One shared hook `components/esign/usePdfDocument.ts` wraps load/teardown.
- **`pdf-lib` (pin ^1.17)** in `verticals/legal` — server-side stamping of the EXECUTED copy for
  file envelopes: draw each placement's resolved value (typed-sig text in the cursive style /
  signature PNG data-URL / dates / data fields) into its rect, then append the existing
  certificate page (`esign/fileCertificate.ts`). Markdown envelopes keep the existing
  `resolveExecutedMarkdown` + react-pdf path (values replace markers in the body). Both paths
  record the executed copy as a new immutable `document_version` exactly as today.
- `@react-pdf/renderer` stays the generation pipeline; note the #349 React-19 dynamic-import
  guard precedent when touching its call sites.

### 5.5 Send API unification

Today: `sendForSignature` (drafts, `mcp/tools/sendForSignature.ts`) and `legal.esign.send_file`
(uploads, `api/esignFile.ts`) with divergent payload shapes. Keep BOTH MCP tool names (stable
external contracts) but converge them on one internal builder
`api/esignSend.ts buildAndSubmitEnvelope(ctx, input)` where `input` adds:
`recipients[].role: 'needs_to_sign'|'needs_to_view'|'receives_copy'` (default sign),
`placements: FieldPlacement[]`, `message?: string`. The `esign.send` handler
(`handlers/esign.ts`) gains: write `signer_role` per request, `envelope_placements` +
`envelope_message` on the envelope; delivery branches (§9.2). `preparedMarkdown` (the old
tag-insertion leg) is dropped from the draft tool — placements arrive as data, the body is never
mutated at send time anymore (the markers already in the body are provenance, not instructions).

## 6. Template-embedded signature config (ES-3 — THE GATING ITEM, 15.20)

### 6.1 Config shape

New `template_esign_config` json attribute (0187) on the `template` entity kind — formalizing
and superseding the runtime-defined `template_signature`:

```ts
export interface TemplateEsignConfig {
  signable: boolean
  roles: Array<{
    key: string            // the marker signer key this role owns ({{sign:<key>}})
    label: string          // "Client", "Managing Member", …
    recipientRole: 'needs_to_sign' | 'needs_to_view' | 'receives_copy'
    bind: 'matter_primary_contact' | 'attorney_of_record' | `contact_role:${string}` | 'manual'
    order: number          // signing order default; equal = parallel
  }>
}
```

Read via a defensive parser (`parseTemplateEsignConfig`, UNSIGNED-style fallback exactly like
`parseTemplateSignature` at `queries/templates.ts:48-55`); legacy `template_signature` values
read as `{ signable: required, roles: signer_roles.map(r => ({ key: r, label: r,
recipientRole: 'needs_to_sign', bind: r === 'attorney' ? 'attorney_of_record' :
'matter_primary_contact', order: 1 }) }` — migrated forward on next save, no data migration.

**Where the blocks live**: in the template BODY as SIG-BLOCK-1 markers (that's already the
canonical emit — `buildExecutionBlock`). The config carries roles/bindings/order; the body
carries the anchor positions. Service-bound templates nest the same object at
`workflow_definition.transitions.document_templates.esign[docKind]` — pure config inside the
existing versioned service upsert, no new kind needed (mirrors how `templates[docKind]` lives
there).

### 6.2 Template editor surface (15.20a)

`TemplateEditorModal.tsx` / service templates page gain an **eSign panel** (below the fields
panel): "Signable" toggle; role rows (label, recipient-role select, bind select, order);
per-role **"Insert signature block"** button that inserts the `buildExecutionBlock` output for
that role at the cursor — rendered in TipTap as the existing ruled `SignatureLineNode` lines,
NEVER raw `{{sign:…}}` text (15.16b: the attorney sees ruled lines with labels; the markers are
the storage). The panel warns on drift: markers in the body whose key has no role row, and roles
with no markers (same orphan-report pattern as `validateProposedTemplate`).

### 6.3 AI/wizard authoring (15.20b, #308 self-describing contract)

`api/templateAuthoring.ts` contract extension: `loadTemplateContext` adds the esign vocabulary
(marker grammar, role bind options, existing config) so the build-wizard model can mark a doc
signable, assign roles, and emit role-tagged blocks in the proposed body;
`validateProposedTemplate` adds the signable checks (marker keys ⊆ config role keys; a signable
template must contain ≥1 `{{sign:…}}` for each `needs_to_sign` role); `createTemplateAI` /
`approve-from-ai/route.ts` persist `template_esign_config` alongside the body (trace-first agent
write, unchanged discipline). The service-builder wizard's document step exposes the same
config UI as §6.2 (shared panel component).

### 6.4 Intake → auto-bind (15.20c)

Nothing new to build at generation time: generation already merges `{{tokens}}` and emits the
markers; `buildExecutionBlock` already prints resolved names (`Name: **<name>**`) when known.
The NEW piece is envelope assembly: `api/esignPrefill.ts resolveTemplateRecipients(ctx,
{ matterEntityId, config }) → recipients[]` — per role, resolve `bind` against the matter
(primary contact via the existing matter⇄contact relationship; `attorney_of_record` from the
firm profile/matter attorney; `contact_role:<r>` via contact-role relationships; `manual` →
empty row the attorney fills). Result: after intake, a generated signable doc opens the
composer with recipients resolved AND fields pre-placed (§5.2) — e-sign-ready with zero manual
setup, which is exactly the 15.20d bar.

## 7. Workflow-embedded e-sign step (ES-4, 15.17b)

For signable doc kinds, the service workflow gains an **e-sign step** after the approve step
(config-as-data in `workflow_definition.transitions`, the backhalf-blocks #318 pattern; step
config `{ kind: 'esign', docKind }`). The builder wizard adds it automatically when a service's
doc type is signable (§6.3). Runner behavior (`components/` runner modals, #317/#319 family):
when the step becomes current, the modal shows a summary card (document vN approved · N
recipients resolved · fields pre-placed) with ONE primary action **"Review & send"** → opens
`EsignComposer` in `workflow-step` mode: document = approved version (rendered via §5.2 route),
placements = template anchors, recipients = `resolveTemplateRecipients` output; the attorney
adjusts if needed and Sends — the SAME `esign.send`. Step completes on the `esign.sent` event;
the envelope's `esign.completed` advances the workflow (the #320 loop's existing lifecycle
dispatch — `dispatchLifecycleEvent` in `handlers/esign.ts` — gains the step-advance hook).
No envelope is persisted before the attorney confirms (§2 principle 4). Per 15.13 discipline:
the step modal has NO dead Continue button — Review & send is the advancing action.

## 8. Entry-point unification (ES-5, E7/E8)

Every launcher opens `EsignComposer`; every label reads **"eSign"** (15.16a rename sweep):

| Entry point | Today | After |
|---|---|---|
| eSign page header | "New envelope" → `/attorney/esign/new` page | "eSign" button → composer modal (`source: {kind:'upload'}`); the `/new` route renders the composer full-page for deep-linking |
| Matter documents tab / document actions | "Send for signature" → PrepareSignature modal | "eSign" → composer (`source: {kind:'document', …}`) |
| Review surface (reader + runner modal, one toolbar per 15.15) | "Send for signature" | "eSign" → composer on the current version |
| Workflow e-sign step | — (new) | §7 confirm-and-send |
| Chat (attorney) | `prepare_envelope` ClientTool → PrepareSignature launch | same tool, launch descriptor now opens the composer; descriptor gains `{ mode: 'document' | 'blank' }` so "eSign a PDF for me" opens the blank/upload composer instead of dead-ending (E8) — the tool STILL writes nothing and the reply stays one short pointer sentence |
| Portal | SignDocument signer surface | unchanged entry; new overlay renderer (§9.3) |

`UnifiedAssistantChat.tsx` handles the launch event exactly like the existing
`EnvelopePrepareLaunch` wiring — extend the descriptor type, no new channel. The old
`legal.esign.send_file` / `sendForSignature` MCP tools keep working through §5.5's builder (chat
and API callers never regress).

## 9. Delivery — email + portal (the seam the P0 fix slots into)

### 9.1 Status of the P0

The send pipeline WORKS (P0 investigation, 2026-07-20): email dispatch fired; the walk's
"nothing arrived" was a wrong-contact pick (two "Joseph A Pacheco" contacts), and the empty
portal tab was the `draft_of`-only join — fixed by `fix/portal-esign-visibility` (landed
baseline for this design). Residual from that finding, IN this design: the composer's contact
typeahead shows email alongside name (disambiguates same-name contacts at pick time); CRM
merge/dedupe stays a separate backlog item.

### 9.2 Role-aware dispatch (extends `handlers/esign.ts` delivery)

- `needs_to_sign` — exactly today's flow: routing-group delivery, `esign_sign_request` (link) or
  `esign_sign_request_portal` (portal) notification, blocks completion.
- `needs_to_view` — delivered with the FIRST routing group (viewers don't gate anything): a
  view-only token link (same `signingToken.ts` HMAC token with a `view` scope claim added to
  `SigningTokenPayload`; the signer surface renders read-only, no adopt/sign controls);
  `esign.opened` records their view; never blocks completion.
- `receives_copy` — no link at send; on `esign.completed`, the executed copy goes to them (new
  `esign.copy_delivered` event, 0186; email carries the executed PDF the way `sendInvoice`
  attaches via `enqueueClientEmail`).

Completion rule change in one place: "all signers signed" iterates ONLY `signer_role =
needs_to_sign` requests (legacy rows without the attr read as sign — defensive default).

### 9.3 Portal + signer surface

Both channels read the SAME envelope set (the triple-lane queries in `api/esign.ts` — baseline
per §9.1): the portal **Signatures tab** lists pending `needs_to_sign` requests for the
logged-in contact; the notification bell and the list read the same query (15.12's
count/list split closes with the join fix). The signer screen (`SignDocument.tsx`, both portal
and link channels) is rebuilt on the shared renderer: real PDF pages (`PdfCanvas`) with the
signer's `FieldPlacement` boxes overlaid at their rects — tap a box to fill it (signature box →
the EXISTING adopt-signature capture, extracted to `components/esign/AdoptSignature.tsx`
unchanged: Type w/ 3 cursive styles, Draw, consent); `date` boxes render "(auto)" and fill at
sign submit; required boxes gate the Sign button; legacy marker envelopes (no placements) keep
the current whole-line flow. Uploaded-PDF envelopes finally show the actual document (kills the
15.8 placeholder for signers too).

### 9.4 The signing email (15.24)

Add branded builders to `src/email/templates.ts` BUILDERS for the refs that today fall back to
plaintext: `esign-sign-request`, `esign-sign-request-portal`, plus `esign-copy-delivered` (new
route, 0186). Shape per the comp, in OUR language: sender identity "<Attorney> via <Firm>";
subject = envelope subject; navy hero panel (document icon + "<Attorney> sent you a document to
review and sign."); ONE gold CTA **"Review document"** (the secure link / portal URL); below:
sender name + the envelope's personal message (`envelope_message`); clean footer. Plaintext part
stays (multipart/alternative, house rule). Tenant-awareness: the `FIRM` constant in
`src/email/brand.ts` is hardcoded Pacheco — these builders take firm identity from the
notification variables (attorney/firm name threaded by the send handler from
`getTenantSettings`), NOT from `FIRM`; full de-hardcoding of the shell rides FB-D, but no NEW
hardcoding lands here.

## 10. Data model + migrations (PLANNED — not applied in this PR)

Reserved numbers **0186** and **0187** (frontier on main = 0184; 0185 belongs to another lane).
Ids follow the house convention: 4th segment = table discriminator, collision lane in the
trailing segment. Reserved lanes: **0186 → trailing `…0010152200`-block, 0187 → trailing
`…0010152300`-block** (verified collision-free: no `10152` trailing id exists in any migration).
Both files: `SELECT set_config('app.tenant_id', '…0001', false)` tenant-zero seed, every insert
`ON CONFLICT (id) DO NOTHING`, explicit all-tenant catch-up loops for existing tenants (the
0180 idiom: `NOT EXISTS` by `kind_name`, per-tenant `on_entity_kind_id` resolved BY NAME,
`gen_random_uuid()` ids) — with `cp_sync_all_tenant_vocab()` (0174) as the standing backstop —
and `SELECT public.sync_migration_history();` at the end. Applied post-merge by the orchestrator
via the runbook; one `migrate:vertical` applies both.

### 0186_esign_recipient_roles_and_placements.sql

| id | table | kind_name | notes |
|---|---|---|---|
| `00000000-0000-0000-1011-000010152200` | attribute | `signer_role` | on `signature_request` (`…1010-…00e2`); enum `needs_to_sign \| needs_to_view \| receives_copy`; absent reads as needs_to_sign |
| `00000000-0000-0000-1011-000010152201` | attribute | `envelope_placements` | on `signature_envelope` (`…1010-…00e1`); json `FieldPlacement[]` (§5.1); supersedes `envelope_fields` for new envelopes |
| `00000000-0000-0000-1011-000010152202` | attribute | `envelope_message` | on `signature_envelope`; text; the sender's personal message (15.24 email body) |
| `00000000-0000-0000-1014-000010152220` | event | `esign.copy_delivered` | `is_state_change=false`; a receives_copy recipient was sent the executed copy |
| `00000000-0000-0000-1030-000010152230` | notification route | `esign_copy_delivered` | channel email, `template_ref 'esign-copy-delivered'`, action = bootstrap action (0043/0044 route precedent) |

No new actions (roles/placements/message ride the existing `esign.send` payload; §2 principle 4
means no draft-envelope edit actions exist).

### 0187_template_esign_config.sql

| id | table | kind_name | notes |
|---|---|---|---|
| `00000000-0000-0000-1011-000010152300` | attribute | `template_esign_config` | on `template` (`…1010-…000008`); json `TemplateEsignConfig` (§6.1); written via existing `legal.template.update` |
| `00000000-0000-0000-1011-000010152301` | attribute | `template_signature` | **formalization**: the runtime-`kind.define`d kind becomes a migration-recorded row — guarded `NOT EXISTS by kind_name` per tenant (prod tenant-zero already has it; this records it for fresh replays and drifted tenants) |

Service-bound esign config needs NO kind (nested json inside
`transitions.document_templates`, an existing versioned store). Legacy `template_signature`
values keep reading (§6.1 fallback); no data migration.

## 11. What gets DELETED (no zombie paths)

Removed in the ES-5 cutover PR, same diff that flips the entry points:
- `apps/legal-demo/components/PrepareSignature.tsx` — whole file (the anchor-tag Fields UI,
  founder-rejected 15.16).
- `apps/legal-demo/components/NewEnvelopeWizard.tsx` — whole file (superseded by the composer).
- The synthetic preview block in `app/attorney/esign/[envelopeId]/page.tsx` (~354-370) and its
  `li-esign-preview-*` / `li-esign-signhere-*` CSS rules — replaced by `PdfCanvas` + overlays.
- Every "Send for signature" label → "eSign"; the `"Signature requested: "` subject prefix
  (`api/esignFile.ts:116`).
- `sendForSignature`'s `preparedMarkdown` input leg (§5.5) — the tag-insertion write path dies
  with the UI that produced it.
- Orphaned CSS from the deleted components (`li-esign-wiz-*` rules that only they used) — sweep
  with `css:check` + grep before delete; shared rules the composer reuses stay.
Kept deliberately: `esign/fields.ts` + `executionBlock.ts` (the storage grammar), the
`SignDocument` adopt-signature capture (extracted), `esignFile.ts` upload, all MCP tool names.

## 12. Build plan — work packages

Order: **ES-1 → ES-2 → ES-5(cutover) ∥ ES-3 → ES-4 → ES-6.** ES-1/ES-2 are one lane (ES-2
builds inside the composer ES-1 ships); the old flows stay live until the ES-5 cutover so no
half-built wizard ever fronts prod. ES-3 can start in parallel after this design merges (its
surface is the template editor, not the composer). Worktree per WP; full local gate
(format/lint/typecheck/real `next build`/test:unit/css:check); new test files added to the
explicit test:unit list; migrations planned in-branch, applied post-merge via the runbook only.

**ES-1 — Unified send wizard (Sonnet).**
NEW `components/esign/{EsignComposer,MatterContactPicker,useEnvelopeDraft}.tsx`;
`api/esignSend.ts` (builder), handler role/message/placement writes (`handlers/esign.ts`),
role-aware dispatch + completion rule (§9.2), `signingToken.ts` view scope,
`mcp/tools/sendForSignature.ts` + `api/esignFile.ts` payload extension, `esign/placements.ts`
types, migration file 0186 (planned), branded email builders (§9.4, `src/email/templates.ts` +
`api/notificationTemplates.ts` route ref). Reuse: Combobox, li-esign-suggest typeahead, Modal,
save_signers_as_contacts. Tests: role dispatch matrix (sign/view/copy × routing order),
completion-ignores-viewers, picker cross-filter logic, placement schema parse/defensive-read,
email builder snapshots.
**ES-2 — Placement surface, FLAGSHIP (Opus).**
NEW `components/esign/{PdfCanvas,usePdfDocument,FieldPalette,FieldBox,SignerSwitcher,PageThumbs,
FieldProps,AdoptSignature}.tsx`; deps pdfjs-dist + pdf-lib (§5.4); render route
`app/api/attorney/esign/render/route.ts` + `draftPdf.ts` marker map (§5.2);
`esign/placementData.ts` (§5.3); executed-copy stamping (`esign/` pdf-lib path +
`fileCertificate.ts` append); `SignDocument.tsx` rebuild on the overlay renderer (§9.3);
`fields.ts` grammar extension; envelope detail real preview. Tests: marker-map↔rect derivation,
normalized-coords round-trip, placementData resolution order + FIRM_DEFAULTS-never poison test,
stamping golden PDF, legacy (placement-less) envelope fallback.
**ES-3 — Template config + AI authoring + intake autobind (Sonnet, this doc = the design).**
`queries/templates.ts` (config parse + select), `api/standaloneTemplates.ts`,
`TemplateEditorModal.tsx` + `components/templates/` eSign panel + insert-block button,
`api/templateAuthoring.ts` contract + validation, `approve-from-ai` route,
`api/esignPrefill.ts` (§6.4), service upsert esign nesting (`api/services.ts`), migration file
0187 (planned). Tests: legacy template_signature fallback, marker↔role drift validation, AI
proposal round-trip, bind resolution per rule.
**ES-4 — Workflow e-sign step (Sonnet).**
Workflow step kind wiring in `transitions` + builder wizard auto-add; runner modal step card +
composer `workflow-step` mode; `esign.sent` step completion + `esign.completed` advance hook
(`handlers/esign.ts` lifecycle dispatch). Tests: step advance on sent/completed, no-Continue
footer, unsignable-doc services unaffected.
**ES-5 — Entry-point unification + cutover (Sonnet).**
All §8 launchers; `esignLaunchTools.ts` descriptor extension + `UnifiedAssistantChat.tsx`
handling; the FULL §11 deletion list; "eSign" label sweep (grep `Send for signature` → zero
hits outside history). Tests: launch descriptor modes; a Haiku click-through walk of every
entry point.
**ES-6 — Live prod proof (walk script, Haiku walk + orchestrator).**
On Pacheco: builder marks a template signable w/ roles → intake a test matter → generate →
approve → workflow e-sign step opens pre-resolved → send → branded email received + portal
Signatures tab shows it (same envelope set) → client signs on real PDF w/ auto-date → executed
copy + certificate → copy recipient gets `esign.copy_delivered` → timeline shows the full event
chain. Fixtures archived after (invariant-14: through the action layer). Proves 15.20d — the
loop Joe said gates everything else.

## 13. Open founder questions (few — everything else is decided above)

1. Multi-document envelopes (DocuSign supports; our envelope model is 1 doc): defer to a later
   `envelope_of` many-lane WP, or pull into ES-1? Recommendation: defer — nothing in the walk
   asked for it.
2. Viewer (`needs_to_view`) delivery timing: with the first routing group (designed above) or
   only at completion? Designed = first group; flip is one line in the dispatch branch.
3. The 8-color signer palette hexes (§4) — approve or tune against the LI comp on first ES-2
   screenshot.

## Critical files

`verticals/legal/src/esign/{fields,executionBlock,placements*,placementData*}.ts` ·
`verticals/legal/src/handlers/esign.ts` · `verticals/legal/src/api/{esignSend*,esignFile,
esignPrefill*,templateAuthoring,templateMerge,services}.ts` ·
`apps/legal-demo/components/esign/*` (new) · `apps/legal-demo/components/{PrepareSignature,
NewEnvelopeWizard}.tsx` (delete) · `apps/legal-demo/app/attorney/esign/**` ·
`verticals/legal/src/email/templates.ts` · `supabase/migrations_vertical/018{6,7}_*.sql`
(planned). (* = new file)
