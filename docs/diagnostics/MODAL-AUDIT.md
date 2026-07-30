# Modal & document-surface audit

Standing principle (founder, 2026-07-24): document approval, document editing, document
review, template editing, e-sign, workflow editing, and intake-form editing are each ONE
reusable pop-out component used identically everywhere — never a second bespoke editor
built for a new page. This file is the 1-by-1 audit of that principle. First pass
2026-07-30 (DOC-RENDER-2 session); verified by grep of actual imports, not from memory.
Update in place when a surface is added or consolidated.

## Verdict summary

The INNER editor for every concern is already a single shared component. Divergence is
at the WRAPPER level (full page vs pop-out modal hosting the same inner editor) and in
one leftover inline editor. Document *rendering* (as opposed to editing) was unified by
DOC-RENDER-1/-2 — every document body now renders through `DocumentSheet`.

## Concern-by-concern

| Concern | The ONE component | Used by | Verdict |
|---|---|---|---|
| Template editing (inner) | `components/templates/TemplateEditor` | templates page, service Templates tab, `TemplateEditorModal`, `configEditors` | ✅ one inner editor |
| Template editing (pop-out) | `TemplateEditorModal` | `TemplateProposalCard` (builder chat), `UnifiedAssistantChat` | ⚠️ see gap 1 |
| Questionnaire / intake-form editing | `QuestionnaireBuilder` (inner) via `QuestionnaireEditorModal` (pop-out) | questionnaires page, builder chat, proposal card | ✅ |
| Workflow editing | `WorkflowBuilder` (inner) via `WorkflowEditorModal` (pop-out) | workflow page, builder chat, proposal card | ✅ |
| Document review/approval | `DocumentReviewer` | review page (`review/[versionId]`), workflow runner (`RunnerReview`) | ✅ |
| Document editing (tracked changes) | `TrackedChangesEditor` | only inside `DocumentReviewer` | ✅ |
| E-sign composing | `esign/EsignComposer` (ESIGN-UNIFY-1) | compose page, workflow step (`EsignWorkflowStep`), signature task, assistant chat | ✅ |
| E-sign signing | `SignDocument` | portal sign, public token sign | ✅ |
| Email composing | `MailComposer` (inner) | mail page, `EmailComposeModal`, signature settings | ✅ |
| Send-to-client | `SendToClientModal` | matter page, documents tab, `DocumentReviewer` | ✅ |
| Service / cost / config editing | `ServiceEditorModal` / `CostEditorModal` / `ConfigEditModal` | their proposal cards + `configEditors` | ✅ |

## Document RENDERING surfaces (DOC-RENDER-1/-2, all through `DocumentSheet`)

- Review reader — `full` variant + persisted per-document font (EDITOR-FIX-1 item 7).
- Share link `/d/[versionId]` — `full` + persisted font (DOC-RENDER-2).
- E-sign signing pane (markdown docs) — `fit` + persisted font (DOC-RENDER-2); PDF docs render the real file via `PdfCanvas`.
- Executed-copy review (signature task) — `fit` + persisted font (DOC-RENDER-2).
- Client-portal engagement gate — `fit`, serif (merged template; no per-version font exists).
- Thumbnails (template gallery, service Templates tab, builder proposal card) — `DocumentThumb` (`thumb` variant), sanitized render, never plain-text stripping.
- Template editor + its preview — the `li-tpl-page`/`tpl-editor-content` system (EB Garamond letter sheet), shared editor⇄preview by design.

Deliberately NOT documents (do not "fix" these onto DocumentSheet): assistant-chat
markdown (`renderMarkdown`, escapes all HTML), matter Brief (`BriefModal`, chat
renderer), email bodies (`sanitizeEmailHtml` server-side; mail reads as mail, not as a
letter page), firm signature block in the composer.

## Open gaps (consolidation candidates, in priority order)

1. **Service Templates tab still hosts an inline expanded editor** (`app/attorney/services/[serviceKey]/templates/page.tsx` — the "Open editor" expander) instead of invoking `TemplateEditorModal`. Same inner `TemplateEditor`, so no logic is duplicated, but the chrome/save wiring is a second implementation of what the modal already does (AI assist rail, save-new-version, eSign panel). Consolidating it onto `TemplateEditorModal` is the one real violation of the pop-out principle left in template land.
2. **Page-vs-modal wrapper duality** — templates page and workflow page host their inner editors as full pages while every other entry point uses the pop-out modal. Tolerable (flagship pages), but if the principle is read strictly, the pages could open the same modals instead. Founder call.
3. **Workflow e-sign step UX** (builder-walk gap #6) — `EsignWorkflowStep` does invoke the unified `EsignComposer`, but the pre-wiring the founder asked for (matter contacts pre-filled as recipients, approved doc pre-loaded, reachable in-place) is tracked in `exsto-law-builder-multimember-contacts` gaps 1/5/6 and is NOT closed by this audit.

## Known provenance issue (logged here for the next substrate session)

`verticals/legal/src/handlers/template.ts:35` hardcodes `sourceType: 'human'` for every
template attribute write, even when the acting actor is the `agent`-type Claude actor
(assistant-made edits, and the 2026-07-30 DOC-RENDER-2 heal, are stamped `human:<agent-id>`).
Hard rule 4 wants typed sources (`agent:` vs `human:`). Other handlers likely share the
pattern — worth one sweep, deriving source type from the actor row instead of a literal.
