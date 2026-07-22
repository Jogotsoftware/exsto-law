# ENGAGEMENT-TEMPLATES-1 — engagement letters as a first-class template library

Founder direction (2026-07-22): "the engagement agreement should look like the
template editor on the attorney side, with multiple engagement letter types/
templates and all the same functionality as the template editor, just with
different variables wired to client info, firm info, and rates."

Selection model (founder): **one firm default**, with the option to create more
and (later) pick a different letter by service/matter-type or by client — but it
**always falls back to the firm default**.

## Where we start (already true)
- The uploaded engagement letter is ALREADY a real standalone template
  (`createTemplate`, category 'document') — editable in /attorney/templates with
  full functionality (rich text, variables, e-sign config, AI enhance).
- `engagement_template` firm_settings attribute (0189) = a SINGLE pointer to that
  one template. The gate resolves it via getClientEngagementAgreement.
- So "editor parity + wired variables" is mostly present; what's missing is
  MULTIPLE letters + a real library UX + rate variables.

## Phases

### Phase 1 — the library (this build). NO migration required.
- **Type them**: created engagement letters get `docKind = 'engagement_letter'`
  (createTemplate already takes docKind; stored in version metadata + entity
  attrs — a free string, no migration). The import names them + types them.
- **`engagement_template` pointer = the firm DEFAULT** (repurpose the existing
  0189 attribute; setEngagementTemplate already sets it).
- **API** (verticals/legal/src/api/engagementLibrary.ts):
  - `listEngagementLetters(ctx)` → templates with docKind 'engagement_letter'
    UNION the current default pointer's template (so the pre-existing untyped
    Pacheco letter still shows), each with `{ id, name, isDefault, updatedAt }`.
  - `setDefaultEngagementLetter(ctx, templateId)` → setEngagementTemplate.
  - `removeEngagementLetter(ctx, templateId)` → retireTemplate; if it was the
    default, clear the pointer (setEngagementTemplate(null)).
  - import: create with docKind + a name; if no default yet, set it default.
- **MCP tools**: legal.firm.engagement_letters.list / .set_default / .remove
  (+ import already async via #480; rename to fit the library).
- **Settings UI** (attorney/settings/firm): the single card becomes a LIBRARY —
  list letters (name, Default badge, Edit → /attorney/templates, Set default,
  Remove) + Upload another. Reuses the async import+poll from #480.
- **Resolution unchanged**: getClientEngagementAgreement uses the default pointer
  (correct end-state per founder: "always goes to firm default anyways").

### Phase 1.5 — rate variables (fold in if time; else fast-follow)
- Wire `{{firm_hourly_rate}}` (+ litigation) into the gate merge from firm
  settings so a letter can show the live firm rate instead of a frozen number.
  Addresses the $300-vs-$350 mismatch (firm_default_hourly_rate vs the letter).

### Phase 2 — per-service / per-client selection (later)
- A letter may be assigned to a service/matter-type or a client; the gate
  resolves override → default. The gate is pre-matter, so a per-service override
  keys off the intake's requested service. Always falls back to the firm default.

## Hazards
- The existing Pacheco letter (098c317e) is untyped (docKind null) — the list
  must include the default-pointer template regardless of docKind, and the import
  should backfill docKind when it (re)touches a letter.
- FIRM_DEFAULTS must never reach document merge (autobind lesson).
- Removing the default must not leave the gate pointing at a retired template —
  clear the pointer.
- No migration in Phase 1 (docKind is a free string; pointer already exists).
