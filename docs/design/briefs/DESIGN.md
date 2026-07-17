# Brief Engine — Design (exsto-law)
(Produced by Opus design agent 2026-07-17; persisted verbatim by the orchestrator. Implementation brief for WP1–WP5.)

## 0. What already exists (the proto-briefs to build on, not around)
- verticals/legal/src/api/assistantContext.ts — buildMatterAssistantContext()/buildContactAssistantContext(): per-depth token budgets (DEPTH_BUDGETS), deterministic source order, the `full` vs `framing` privacy split, untrusted-data fencing («BEGIN MATTER DATA»), safeField() neutralization. Most important precedent.
- verticals/legal/src/queries/clientContext.ts — getClientContext()/formatClientContext(), surfaced as MCP tool legal.client.context (notesTools.ts). The proto-Client-Brief.
- verticals/legal/src/api/buildBrief.ts — NAMING COLLISION: that is the service-builder wizard live-state brief. Do not overload. New names: matter_brief / client_brief / service_digest.
- Review reader "Matter context" panel = the draft's reasoning trace, a UI slot the Matter Brief can enrich, not a source.
Gap: existing assemblers concatenate raw material; nothing synthesizes an attorney-readable narrative, nothing is persisted/versioned/refreshable. That is the Brief engine.

## 1. Architecture — one engine, three brief types
assembleBriefEvidence(ctx, scope, budget) → EvidenceBundle  (deterministic, read-only, tenant-scoped)
synthesizeBrief(ctx, bundle, briefType)   → { json, markdown, trace }  (one Claude call, one reasoning trace)
persistBrief(ctx, target, briefType, out) → brief entity (append-only, superseding body)

- Assembly: pure orchestration over existing readers (gatherMatterMaterial, getClientContext, getMatterHistory, mail/task/billing/esign readers). Bounded EvidenceBundle: labelled, source-tagged, budget-clipped sections, explicit source-priority order, sourceWatermark (max recorded_at/HLC seen). No model call; unit-testable like assembleDraftingPrompt.
- Synthesis: one call via adapters/claude.ts. Output = structured JSON (sections w/ confidence, sourceRefs entity:<id>, quoted vs summarized flags) + rendered markdown. Honest confidence <1.0, model identity captured.
- Persistence: `note` pattern (entity.create + append-only attribute.set supersession). Every generation = AI operation w/ reasoning trace (exsto-ai-operation).

| Type | Assembly scope | Synthesis intent | External leg |
|---|---|---|---|
| Matter Brief | one matter, all sources | "everything about this matter, now" | none |
| Client Brief | client + all their matters (getClientContext) | "who this client is + where every matter stands" | yes — business + light person research |
| Service Digest | accepted revisions/edits across one service's documents | "how attorneys change this service's drafts → drafting guidance" | none |

Behind-the-scenes packaging (all three): (1) in-process exports from @exsto/legal — getOrRefreshMatterBrief(ctx, matterEntityId, opts) etc.; (2) MCP tools (§5); (3) optional capability-registry handlers (CAPABILITY_HANDLERS, capabilityRuntime.ts) → step-invocable + ad-hoc-runnable + autorun for free.

## 2. Data-source inventory (verified)
| Source | In-process helper | MCP tool |
|---|---|---|
| Matter core + intake answers + transcript text | getMatter (queries/matters) | legal.matter.get |
| Timeline/audit (watermark source) | getMatterHistory (queries/history) | legal.matter.history |
| Portal thread | getMatterThread / listPortalThreads | legal.matter.thread_get, legal.matter.portal_threads |
| Gmail threads (matter-scoped) | listMailThreads, matterCommunicationBodies (api/mailWorkspace) | legal.mail.threads {matterEntityId}, legal.mail.thread_get |
| Ingested comms | matterCommunications | legal.matter.communications |
| Documents + versions | listMatterDraftVersions, getDraftVersion (queries/drafts); listMatterDocuments (api/documentUpload) | legal.draft.versions, legal.document.list |
| Tasks | listTasksByMatter (queries/tasks) | legal.task.list, legal.task.list_due |
| Billing/invoices | listMatterInvoiced (queries/billing) | legal.billing.matter_invoiced, legal.billing.unbilled, legal.invoice.list |
| Calendar/meetings | listMeetingsForMatter (queries/meetings) | legal.meeting.list_for_matter, legal.calendar.events |
| Questionnaire template | — | legal.questionnaire.get_template |
| Transcripts (Granola, in-repo: api/granolaIngestion, transcript_of_matter/_client rels, adapters/granola.ts) | getClientContext transcripts | legal.granola.*, legal.call.list_for_matter |
| Notes | listNotesForEntity (queries/notes) | legal.note.list |
| eSign | — | legal.esign.envelopes_list, legal.esign.status |
| Prior research | listMatterResearch (api/research) | legal.research.list |
| Client assembly | getClientContext / formatClientContext | legal.client.context |

2a. Service Digest signal (already captured append-only): reviseDraftText (api/reviseDraft) stores revision_instruction in the trace; document.edit (api/reviewDraft) persists accepted inline edits as new document_version rows w/ notes; draft.request_revision records asks. Digest = per-service assembly of accepted revision instructions + edit notes (+ optional redline deltas) → synthesized "house drafting preferences for this service" → injected into runDraftGeneration. No new capture needed.

## 3. Persistence & caching (definition rows only)
DECISION: persist (cached, versioned, refreshable) — read-heavy, expensive to make, must be a stable cached prefix for the assistant.
- Entity kind: brief (supports_temporal_state=true, supports_judgment=false, requires_period=false)
- Attribute kinds: brief_type ('matter'|'client'|'service_digest'), brief_markdown (superseded per regen), brief_json, brief_generated_at (exact_instant), brief_source_watermark, brief_model_identity, brief_confidence, brief_research_json (nullable; Client Brief only — findings + exact outbound queries)
- Relationship: brief_of (brief → matter|client|service entity), one-active-per-(target,type)
- Action kind: legal.brief.generate — requires_reasoning_trace=true, default_autonomy_tier=notify
- Staleness: stale = currentWatermark (max recorded_at over target's actions/events) > brief_source_watermark. `get` returns cached + stale flag, never generates. Regeneration explicit or policy-driven. History retained via supersession.
- Seed migration: number above 0168, fresh id-block, ON CONFLICT DO NOTHING (exsto-add-kind / exsto-substrate-migration).

## 4. External-research privacy guard
New pure function w/ CLOSED input type — matter facts un-passable by construction:
  // verticals/legal/src/api/briefResearchGuard.ts
  interface PublicIdentifiers { personName?; companyLegalName?; publicDomain?; jurisdiction? }
  buildPublicResearchQuery(ids) → { company?: string; person?: string }
Rules: (1) allowlist-only inputs (client name, company_name, public_domain attrs); (2) templated outbound queries, no free-text passthrough; (3) separate call path pre-synthesis via runPerplexityResearch (adapters/perplexity — already framing-only); (4) record what left the firm (brief_research_json + research.recorded event, provenance integration:perplexity); (5) person search opt-in + minimal (name only), firm setting. Research results read back as fenced untrusted data, lower-confidence, attributed.

## 5. MCP tool signatures
legal.matter.brief.get (read) {matterEntityId} → {brief|null, stale, watermark}
legal.matter.brief.generate (write, trace) {matterEntityId, depth?, force?} → {brief}
legal.client.brief.get (read) {clientEntityId} → {brief|null, stale}
legal.client.brief.generate (write, trace) {clientEntityId, depth?, researchBusiness?, researchPerson?, force?} → {brief, research?}
legal.service.digest.get (read) {serviceKey} / legal.service.digest.generate (write, trace) {serviceKey, force?}
BriefView = { markdown, sections[{heading, body, confidence, sourceRefs}], generatedAt, modelIdentity, confidence, stale }
Reads call query helpers (never model/persist); writes route through submitAction w/ legal.brief.generate + trace. In-process twins for direct import.

## 6. UI integration
- Popup: WP-M Modal (size wide) rendering markdown; DocumentSheet for letter-like reads. Shared <BriefButton scope target/> + <BriefModal/>: calls *.brief.get, cached view + "Refresh" when stale + first-run "Generate" (GemSparkle/GemShimmer).
- Button homes (priority): matter detail header, CRM client detail, review reader (upgrades "Matter context" panel), calendar/meeting detail, mail thread pane, assistant.
- Attorney-only; never on the client portal.

## 7. First 5 consumers
1. Drafting (runDraftGeneration): Service Digest as guidance per service (+ optionally Matter Brief replacing ad-hoc getClientContext block).
2. Assistant (buildClaudeSystem stable/cached prefix): cached brief as grounding block — richer and cheaper (inside prompt-cache breakpoint).
3. Autorun capabilities (capabilityRuntime): upgrade use_client_context; register matter_brief/client_brief handlers.
4. Email generation (composeEmailDraft): brief as context block.
5. Meeting prep: "brief me before this consultation" on the linked entity.

## 8. Phased WPs
WP1 assembly engine (no AI, unit-tested, refactors shared readers) → WP2 Matter Brief end-to-end (kinds seed migration + synth + persist + get/generate + matter-header button/modal) → WP3 Client Brief + privacy guard (+ CRM button) → WP4 Service Digest + drafting injection → WP5 fan-out consumers + refresh policy.

## 9. Open founder questions
1 refresh policy (recommend: manual + stale flag) · 2 person-research depth/opt-in · 3 visibility (recommend attorney-only) · 4 history browsing vs latest-only UI · 5 per-brief/monthly spend ceiling · 6 quote vs paraphrase sensitive comms.

## Critical files
assistantContext.ts · clientContext.ts · generateDraft.ts · capabilityRuntime.ts · adapters/perplexity.ts

## FOUNDER DECISIONS (2026-07-17, binding)
1. Refresh: MANUAL + stale flag (get returns cached + stale; Refresh button regenerates; no auto-regen).
2. Person research: quick search INCLUDING LinkedIn lookup; include findings ONLY if verifiable (cross-checked/attributable — unverifiable hits are dropped, not hedged). On by default. Name-only outbound (privacy guard unchanged).
3. Visibility: attorney-only, never portal.
4. Quoting: paraphrase by default, verbatim quotes only where exact wording matters (commitments, deadlines, admissions).
5. (2026-07-17 addendum) Notes are a REQUIRED source for both Matter and Client briefs — already in inventory (listNotesForEntity / legal.note.list); treat as first-class, not optional.
