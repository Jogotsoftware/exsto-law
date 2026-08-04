# Modal & document-surface audit

Standing principle (founder, 2026-07-24): document approval, document editing, document
review, template editing, e-sign, workflow editing, and intake-form editing are each ONE
reusable pop-out component used identically everywhere — never a second bespoke editor
built for a new page. This file is the 1-by-1 audit of that principle. First pass
2026-07-30 (DOC-RENDER-2 session); second pass 2026-08-04 (MODAL-STD-1 session) —
both verified by grep of actual imports, not from memory. Update in place when a
surface is added or consolidated.

## Verdict summary

Second pass correction: the first pass's "every inner editor is already shared" verdict
was wrong for TWO concerns. Questionnaire editing has a full second implementation
(the service-scoped questionnaire page), and workflow editing has a second manual
editor (the per-matter `WorkflowEditor`) — STEP-EDITOR-1 (#311) even says "both manual
step editors" in its own write-up. Everything else holds: divergence is at the WRAPPER
level (full page vs pop-out modal hosting the same inner editor) and one leftover
inline template expander. Document *rendering* (as opposed to editing) was unified by
DOC-RENDER-1/-2 — every document body now renders through `DocumentSheet`.

## Concern-by-concern

| Concern | The ONE component | Used by | Verdict |
|---|---|---|---|
| Template editing (inner) | `components/templates/TemplateEditor` | templates page, service Templates tab, `TemplateEditorModal`, `configEditors` | ✅ one inner editor |
| Template editing (pop-out) | `TemplateEditorModal` | `TemplateProposalCard` (builder chat), `UnifiedAssistantChat` | ⚠️ see gap 1 |
| Questionnaire / intake-form editing | `QuestionnaireBuilder` (inner) via `QuestionnaireEditorModal` (pop-out) | questionnaires page, builder chat, proposal card | ❌ see gap A — the service questionnaire page (`services/[serviceKey]/questionnaire/page.tsx`, 1,037 lines) is a complete SECOND editor with its own `EditorField`/`EditorSection` model; it imports nothing from `QuestionnaireBuilder` |
| Workflow editing | `WorkflowBuilder` (inner, 1,212 lines incl. its own `StepEditor`) via `WorkflowEditorModal` (pop-out) | service workflow page, builder chat, proposal card | ❌ see gap B — `matters/[id]/WorkflowEditor.tsx` (601 lines) is a SECOND manual editor, invoked inline from the matter page; #311 patched both separately |
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

## Open gaps (consolidation candidates, in priority order — renumbered 2026-08-04)

- **Gap A — two questionnaire editors** (found 2026-08-04, missed by first pass). `app/attorney/services/[serviceKey]/questionnaire/page.tsx` is a 1,037-line bespoke `QuestionnaireEditorPage` with its own field/section wire model (`wireFieldToEditor`/`editorToWire`), fully parallel to `QuestionnaireBuilder` (507 lines). Real duplicated logic, not just chrome — the largest violation of the principle on the books. Consolidation target: one inner builder, service page invokes `QuestionnaireEditorModal` (or hosts the shared inner builder).
- **Gap B — two manual workflow editors** (found 2026-08-04; #311's own write-up says "both manual step editors"). `matters/[id]/WorkflowEditor.tsx` (601 lines, per-matter instance editing, inline on the matter page) vs `WorkflowBuilder` (definition editing, with its own inner `StepEditor`). They diverge in semantics (instance vs definition) but both hand-build step/edge editing UI; #311 had to fix the same lossless-round-trip bug in each separately, which is exactly the failure mode the principle exists to prevent. Consolidation target: shared step/edge editor core, two thin wrappers — or founder decides instance editing is a distinct concern.
- **Gap C — CLOSED 2026-08-04 (MODAL-STD-1).** The service Templates tab's inline "Open editor" expander was replaced by the shared `TemplateEditorModal`, which grew optional host-context props for it (variable validation/suggestion, live-markdown callback, external editor handle, context panels, preview toggle, collect-at-intake pass-through). One editor+save implementation; the card supplies only its service context (insert-field rail, orphan banner, library row, skill-aware AI panel).
- **Gap D — CLOSED 2026-08-04, founder ruling: not a violation.** The principle stops the same editor being rebuilt per surface, not full pages. Templates/workflow pages hosting the shared inner editor as a page is one implementation with a page-level entry point. Do not reopen.
- **Gap E — workflow e-sign step pre-wiring** (was gap 3) — mostly RESOLVED by ESIGN-STEP-1 (#511): the step opens the shared `EsignComposer` in place, pre-wired with the approved document and template-resolved recipients; the reported dead end traced to the step never having run plus an assistant-guidance gap (logged in INVENTORY.md §6). Still open from the same thread: single-member LLC service has no e-sign step at all (one-step workflow edit, awaiting founder go-ahead).

Verified clean 2026-08-04 (no PR needed): document approval/review (`DocumentReviewer`: review page + `RunnerReview`), document editing (`TrackedChangesEditor` only inside `DocumentReviewer`), e-sign (`EsignComposer`: compose page, `EsignWorkflowStep`, signature task, assistant chat — the reference implementation), engagement-letter library (#487 list page edits via `/attorney/templates?template=…` → the shared `TemplateEditor`). Minor note: `questions/page.tsx` (question bank) does inline per-row question editing — small, self-contained, not counted as a violation.

## Known provenance issue (logged here for the next substrate session)

`verticals/legal/src/handlers/template.ts:35` hardcodes `sourceType: 'human'` for every
template attribute write, even when the acting actor is the `agent`-type Claude actor
(assistant-made edits, and the 2026-07-30 DOC-RENDER-2 heal, are stamped `human:<agent-id>`).
Hard rule 4 wants typed sources (`agent:` vs `human:`). Other handlers likely share the
pattern — worth one sweep, deriving source type from the actor row instead of a literal.
