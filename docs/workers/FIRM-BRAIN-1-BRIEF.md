# FIRM-BRAIN-1 — the assistant stops assuming and starts knowing the firm

**Status:** BRIEF (audited 2026-07-19, post-ASSISTANT-ACTS-1 #393). Nothing in this doc is built yet.
**What this doc is:** the complete prompt/brief for the FIRM-BRAIN thread. It carries (1) the full picture of how the AI assistant works today, (2) a file:line audit of every hardcoded assumption, the skills machinery, and the learning loops, and (3) the work packages with acceptance criteria. A worker session should be able to execute from this doc alone — but per repo doctrine, **verify every claim against the code before acting on it**; line numbers drift.

**Read first:** `CLAUDE.md` (hard rules — action layer, tenancy, append-only, PR hygiene), `ARCHITECTURE.md` for anything substrate-touching, and the relevant `.claude/skills/exsto-*` skill before each kind of change (`exsto-add-kind` for new attributes, `exsto-substrate-migration` for migrations, `exsto-mcp-tool` for tools).

---

## 0. The problem in one paragraph

The platform is multi-tenant (MULTI-TENANT-1 resolves the tenant per request; Pacheco Law, Dev Firm, and more firms coming), but the AI assistant is still a single-tenant Pacheco/North-Carolina machine at the prompt layer. Four runtime prompts assert "Pacheco Law / solo-small / NC / business-law" on every turn; every generated document and email is stamped `jurisdiction: 'NC'` into the append-only substrate as a fact; NC legal playbooks are auto-attached to every firm's drafting; the client portal introduces itself to every firm's clients as "the Pacheco Law client portal assistant"; and the firm has **no way to correct any of it**, because (a) `firm_profile` has no jurisdiction/practice-area/attorney-name attributes and (b) no custom-instructions mechanism exists at any level. Separately, the assistant does not learn: it is stateless across conversations, corrections evaporate, and several built-but-unclosed loops (briefs, observations, embeddings) do nothing.

**The target state (founder's words):** the assistant must be **tenant-aware, user-aware, client-aware, and matter-aware** — it knows which firm it serves, which attorney it's talking to, which client and matter it's grounded in, at every layer of the stack — it must **learn the attorney's tone** and write like them, and it must have **extensive action capabilities**: not just email/doc/e-sign (ASSISTANT-ACTS-1), but the full workspace — tasks, matters, notes, calendar, billing, workflows — behind the proven act-in-place confirmation patterns.

**Jurisdiction doctrine (founder, 2026-07-19): the CLIENT's jurisdiction is just as if not more important than the firm's.** Jurisdiction is fundamentally a **per-matter fact** — where the client, deal, property, or dispute sits — not a firm constant. Services must be **jurisdiction-agnostic shells** ("LLC formation", not "NC LLC formation") that **gather the governing jurisdiction from the client's intake**; the firm's home jurisdiction is only the fallback, and "unset" degrades to honest-ask-never-assume. Every consumer of jurisdiction (drafting stamps, skill resolution, prompts, research framing) resolves through the ladder: **matter (from intake) → firm profile → unset**.

The awareness ladder maps to the WPs: tenant → WP-A, matter/client jurisdiction → WP-A2, user → WP-H, client/matter context → exists (§1.1) but gap-checked in WP-H, tone → WP-G, actions → WP-I.

---

## 1. FULL PICTURE — how the assistant works today

### 1.1 The chat runtime

- **Surface:** `apps/legal-demo/components/UnifiedAssistantChat.tsx` (~3,900 lines) hosted by `components/FeedbackChat.tsx` (the FAB panel), mounted in `app/attorney/layout.tsx`. Since ASSISTANT-ACTS-1 (#393): the panel survives navigation and hard reloads (sessionStorage `exsto.assistant.open` + `exsto.assistant.chatSession`), follows the page (scope re-grounds in place with a `contextNote` divider turn; no remount), and in-chat links navigate client-side.
- **Transport:** `apps/legal-demo/lib/assistantStream.ts` → SSE POST `/api/attorney/assistant/stream` → `verticals/legal/src/api/assistantChat.ts` `assistantChatStream` (non-streaming sibling `assistantChat`).
- **Events:** typed union `AssistantChatStreamEvent`: `meta`, `thinking`, `text`, `drafting`, `skill`, `notice`, `document`, seven `*_proposal` kinds (build wizard), `build_question`, `kind_proposal`, `editor_launch`, `email_compose`, `envelope_prepare`, `done`, `error`.
- **ClientTools** (assembled in `buildAttorneyClientTools`): always — `log_feedback`, `produce_document`, `load_skill` (when a catalog exists), `get_workflow_context` + `propose_workflow`, `open_artifact_editor`; scoped turns — `compose_email` (matter/contact), `prepare_envelope` (matter only); wizard-on — the full build set (`get_service_context`/`propose_service`, questionnaire/template pair, `check_service_completeness`, `propose_cost`, `propose_enable`, `ask_build_question`, capability + kind context/propose). The tool→modal launch pattern (capture server-side → emit event post-loop → client mounts the real modal) is the house pattern; copy `editorLaunchTools.ts` / `composeEmailTool.ts`.
- **Model routing (WP4 of #393):** default picker entry `anthropic:auto`; pure `chooseAutoModel` in `assistantModels.ts` routes each turn (Haiku unless drafting-verb+doc-noun intent, buildMode, >1500-char message, or >60k history chars → Sonnet); resolved in `resolveTurnModel` before the adapter; `meta.model` carries the concrete model; header shows "Auto · <model>". Explicit picks pin. Feedback mode forces Haiku.
- **Context:** `assistantContext.ts` rebuilds a matter/client briefing every turn (emails+bodies, transcript, intake, drafts, tasks, meetings, billing, cross-matter client history via `queries/clientContext.ts`), char-budgeted by depth (`lean|balanced|generous`), wrapped in an untrusted-data fence. Claude gets `full`; the external research model (Perplexity) gets only `framing` (see §2.1 — currently hardcoded NC).
- **Prompt assembly:** `buildClaudeSystem` = STABLE cached prefix (SYSTEM_PROMPT + context + scope-gated act-in-place blocks + wizard blocks + skill catalog + forced skill bodies) + `buildVolatileClaudeSystem` (route, live screen, build brief). One changed byte in the stable half invalidates the prompt cache — thread new per-firm facts into the STABLE half (they're constant per conversation).
- **Persistence:** every exchange = an `assistant.turn` event (action layer) with reply, reasoning, citations, cards (`produced_documents`, `email_drafts`, proposals), usage tokens, `chat_session_id`/`build_session_id`. Threads reload via `listAssistantThread` (scope- or session-keyed).
- **Client portal chat:** `clientAssistantChat.ts` — separate, tool-restricted (`clientPolicy.ts` allowlist), loads exactly one skill (`client-portal.portal-assistant`).

### 1.2 The other AI paths (all Claude via `adapters/claude.ts`, the only Anthropic seam)

| Path | Entry | Skills? | Prompt source |
|---|---|---|---|
| Chat (attorney) | `assistantChat.ts` | catalog + load_skill + forced | SYSTEM_PROMPT (code) |
| Drafting worker | `generateDraft.ts` `runDraftGeneration` | auto (`resolveJurisdictionSkillSlugs`) + picks | per-service config prompt, fallback `templates/drafting-prompt.md` |
| Email compose | `generateEmail.ts` `composeEmailDraft` | auto + picks | `templates/email-drafting-prompt.md` + `house-voice.md` (repo-only, NO config seam) |
| AI doc review | `reviewDocument.ts` | config + auto | `templates/document-review-prompt.md` (clean) |
| Template "Draft with AI" | `standaloneTemplates.ts` | catalog + forced | generic |
| Revise/redline | `reviseDraft.ts` | none | code string (hardcodes NC — §2.1) |
| Brief engines | `briefEngine.ts` / `clientBriefEngine.ts` | none | fixed synthesis prompts (clean) |
| Transcript extraction | `transcriptExtraction.ts` | none | fixed (clean) |
| Capability runtime | `capabilityRuntime.ts` | inherited via delegation | — |
| Portal chat | `clientAssistantChat.ts` | one hardwired skill | BASE_SYSTEM (hardcodes Pacheco — §2.1) |

### 1.3 The skills system (well-built; keep it)

- **Content:** 110 markdown playbooks under `verticals/legal/skills/<area>/` across 14 areas (commercial 9, corporate 10, employment 17, litigation 16, ip 9, privacy 6, regulatory 6, product 4, ai-governance 6, clinic 10, law-student 10, firm-admin 5, client-portal 1, research 1). Frontmatter: slug/name/practice_area/description/when_to_use/user_invocable.
- **Zero skills are structurally jurisdiction-specific.** ~100 bodies say "default to North Carolina *if the attorney gives no jurisdiction, and surface that assumption*" — the right, portable pattern. The NC problem is the CALLERS (§2.2), not the skills.
- **Selection:** `skillContext.ts` — `buildSkillCatalogText` (slug catalog in the prompt; filtered to `user_invocable` and excluding `law-student` via `NON_FIRM_AREAS`), `load_skill` ClientTool (progressive disclosure), `loadForcedSkills`/`buildActiveSkillsText` (attorney `/skills` picks + wizard-forced `firm-admin.build-service`), `rankSkillsForDraft`/`resolveJurisdictionSkillSlugs` (deterministic doc-kind matcher for the drafting paths; jurisdiction is a +2 tie-break, never sufficient alone).
- **Storage/seeding:** skills are substrate rows (migration 0082), seeded/updated ONLY via the action layer: `pnpm seed:skills` (all skills, all active tenants) or the surgical `demo/seed-firm-admin-skills.ts` (5 firm-admin skills, tenant-zero). **Manual, never automatic** — a deploy that changes a skill .md does nothing until someone reseeds; the standing runbook verifies the live row's `valid_from` postdates the deploy.
- **Firm-facing edit path:** MCP `legal.skill.list/get/create/update/archive` exists; **no UI** for skill management (the `/skills` picker only selects).

### 1.4 What "learning" exists (mostly re-assembly, not learning)

- Within-conversation history only reaches the model; sessions persist for human reopening.
- Matter/client context is deterministically re-assembled every turn — richer over time only because the substrate accumulates.
- Persisted briefs exist (staleness-tracked, cached) but are **not** fed into chat.
- Per-attorney `assistant_settings` (model/workRate/webSearch/research/contextDepth) — mechanical knobs, set in the chat widget.
- Voice: static `house-voice.md` doctrine + deterministic `emailVoiceChecks.ts`; one corrective regenerate on the queue path; ACTS-1 advisory chips on the composer path. The register exemplar is a placeholder never replaced.
- Feedback (`log_feedback` → `assistant.turn` kind=feedback → claim/resolve backlog) closes the **developer** loop only.
- Token usage per turn → Settings → AI usage (real, consumed).
- Write-only: observations `question_without_card`/`assistant_tool_cap`/`workflow_proposal_failed` have no readers. `content_embedding` (pgvector, migration 0015) is dormant — nothing inserts or queries.
- Nothing persists attorney corrections, per-client style, or cross-conversation knowledge.

---

## 2. AUDIT — every finding, classified

Classification: **(a)** runtime code/prompt hardcoding — breaks a second firm; **(b)** seed/dev convention — fine but document; **(c)** template content — per-firm data, but note default ships Pacheco/NC.

### 2.1 Runtime prompt hardcoding — (a), the headline cluster

| Where | What | Blast radius |
|---|---|---|
| `assistantChat.ts` SYSTEM_PROMPT first sentence (~L480) | "inside Pacheco Law's practice app — a tool for a solo/small NC business-law firm" | Every turn, every tenant: wrong name, size, state, practice area |
| same prompt, examples ~L494/503/808/822 | NC Wage & Hour Act example; "NC SMLLC" ×3 | Nudges NC framing |
| same prompt, anti-stamping rule ~L828 | asserts "The firm being a North Carolina firm is context for the legal CONTENT" | The guard against NC-stamping itself hardcodes NC |
| `assistantContext.ts` ~L52/420/465 | `JURISDICTION = 'U.S. North Carolina business-law firm'` + `'business law'` fallback in the **Perplexity `framing`** | External research retrieval steered to NC business law for every firm — leaves the building |
| `clientAssistantChat.ts` ~L34 | "You are the Pacheco Law client portal assistant" | Every firm's clients told they're talking to Pacheco |
| `reviseDraft.ts` ~L98 | "revising … under North Carolina law" | Every AI redline NC-framed |

### 2.2 Substrate stamping + skill routing — (a)

- `generateDraft.ts` ~L220 (`draft.merge` payload), ~L321 (`draft.generate` payload): `jurisdiction: 'NC'` written as a permanent fact for every tenant's documents.
- `generateDraft.ts` ~L270, `generateEmail.ts` ~L125/168/222, `reviewDocument.ts` ~L436: `resolveJurisdictionSkillSlugs(..., { jurisdiction: 'NC' })` — NC playbook auto-attachment for every draft/email/review. The resolver's `jurisdiction` param is plumbed and ready; **no caller passes anything but the literal `'NC'`**, and no matter/firm jurisdiction lookup exists anywhere in the path.

### 2.3 Templates/content — (c), with one structural hole

- `templates/drafting-prompt.md` — Pacheco/NC/§57D **fallback** for services without a configured prompt (config-first via `getDraftingPrompt` is the correct pattern — documents are fine).
- `templates/house-voice.md` — Pacheco examples, "Joe Pacheco" signoff, NC statutory-cap example — composed into the email prompt at load time with **no per-tenant override seam** (`loadEmailDraftingPrompt` / `templates/loader.ts` `{{house_voice_doctrine}}`). Effectively (a) until email prompts become config-first like documents.
- Clean: `email-drafting-prompt.md` body, `document-review/redline/transcript-extraction` prompts, brief engines, capabilityRuntime, workflowAuthoring.

### 2.4 Identity fallbacks + ids

- `tenantSettings.ts` ~L31 `FIRM_DEFAULTS = { firmName: 'Pacheco Law Firm', attorneyName: 'Juan Carlos Pacheco' }` — Settings-page fallback for an unpopulated firm — (a) latent. Documents are protected by `getTenantSettingsForMerge`'s honest-MISSING guard; the UI is not. **`attorney_name` has no substrate home at all** (legacy table / defaults only).
- `CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'` duplicated across ~11 AI files — (b) deliberate shared-seed convention, but it's an onboarding precondition (a new tenant MUST seed an actor at this UUID or every AI action fails). Document in the provisioning runbook; optionally centralize the constant.
- `apps/legal-demo/lib/auth.ts` DEV_ATTORNEY (juancarlos@pachecolaw.com, tenant-zero) — dev-only shim, guarded by NODE_ENV. Fine.

### 2.5 App shell — (a), client-facing

- "Pacheco Law" hardcoded on: `app/layout.tsx` metadata, `app/page.tsx` login (×2), `portal/login`, `portal/set-password` (×2), `portal/pay/[invoice]`, `book/manage/[token]` (×2), `components/SignDocument.tsx`, `app/d/[versionId]` public draft page, `api/auth/google/callback`.
- `serviceKey → "NC LLC formation"` label duplicated in 5 places (`app/attorney/page.tsx`, `matters/page.tsx`, `matters/[id]/shared.tsx`, `crm/contacts/[id]/page.tsx`, `components/WeeklyCalendar.tsx`).
- Cosmetic placeholders ("Pacheco Law PLLC", "e.g. NC LLC intake", signature example) — (c), sweep opportunistically.

### 2.6 Per-tenant sources that EXIST today (the replacement inventory)

1. `firm_profile` singleton (migration 0161): `firm_name`, `firm_address`, `firm_phone`, `firm_email` — read via `tenantSettings.ts` (`getTenantSettings` / `getTenantSettingsForMerge` / `getFirmProfile`), write via `legal.firm.set_profile` (`handlers/firmProfile.ts`). **No jurisdiction / practice_areas / attorney_name.**
2. `tenant_settings` legacy table — has `attorney_name` but writes throw; wedge-era.
3. `firmSignature.ts` — signature block derived from firm_profile.
4. `legal.public.firm_branding` (client-safe resolved name+attorney) and `public.resolve_public_firm` (slug→tenant+firm_name) — the public-funnel identity seam from MULTI-TENANT-1.
5. Tenant/actor `display_name` (admin-set).

**The gap:** nothing stores jurisdiction or practice areas. De-hardcoding REQUIRES new `firm_profile` attributes first.

### 2.7 Skills-side gaps

- Catalog is unscoped: every firm sees all ~100 invocable skills regardless of practice areas.
- No-skill paths: brief engines, reviseDraft, transcript extraction, intake authoring, standalone workflow authoring, config regeneration.
- No skill management UI; reseeding is manual and forgettable.
- Portal chat hardwires one skill instead of a portal-scoped catalog.

### 2.8 Learning-side gaps (ranked)

1. No custom instructions (firm-level or per-attorney) — no storage, no UI, no injection.
2. **No attorney-tone learning** — the assistant writes in house-voice doctrine (static) + model default; it never reads the attorney's own sent emails, approved drafts, or portal messages to learn how THEY write. All the raw material already sits in the substrate (communication_message rows the attorney authored, approved document_versions, revise-guidance notes) — nothing distills it.
3. Corrections evaporate — revise/regenerate guidance is applied once, never distilled.
4. Briefs not fed into chat (synthesis + staleness machinery already exists, unused by chat).
5. Observations write-only; embeddings table dormant.
6. House-voice exemplar placeholder never replaced; no per-client learned style.
7. No cross-conversation digest per matter.

### 2.9 Awareness & action inventory (the ladder, audited)

| Layer | State today | Gap |
|---|---|---|
| **Tenant-aware** | Request-scoped ctx.tenantId everywhere (RLS-enforced); but firm FACTS hardcoded (§2.1) | WP-A |
| **User-aware** | ctx.actorId flows on every action (provenance) — but the PROMPT never says who the attorney is. No name, no role, and on **global scope the chat has literally zero context** (`loadContext` returns null) — no "your open matters", no "today's calendar", no "your review queue". The assistant serves an anonymous someone | WP-H |
| **Client-aware** | Contact scope + assembled client history (clientContext.ts) — good; portal chat is client-scoped | verify coverage in WP-H |
| **Matter-aware** | Matter scope briefing (assistantContext.ts) — good; ACTS-1 made it act on the matter | verify coverage in WP-H |
| **Tone-aware** | Static house-voice only | WP-G |

**Action capabilities today vs missing (WP-I raw list).** Can DO from chat: compose/send email, produce documents + edit + save-to-matter, stage e-sign envelopes, file feedback, propose/approve service builds (wizard), open artifact editors, guided new-matter chip walk (local UI flow). CANNOT do (operations that EXIST in the core but have no chat tool): **check the inbox** (list/read email threads, find awaiting-reply), create/complete **tasks** ("remind me…"), add **notes**, create/reschedule **calendar events & bookings** (known gap: booking/rates/settings lack ClientTool wrappers), draft/send **invoices** & record payments, open/advance/skip **workflow steps** (Contract W ops exist: approve/regenerate/skip/client-gate), **request documents from client** (portal request pipeline exists), update **client/contact records**, set **rates/firm settings**, run **transcript extraction** or **brief generation** on demand, **search across matters** ("which matters mention X"), answer **"what's most pressing?"** with real triage (no attention feed exists — WP-H builds it). The MCP registry (`verticals/legal/src/mcp/index.ts` — ~50 tool files) is the authoritative inventory: most of the operation core is already exposed as attorney MCP tools; the chat just can't call them.

---

## 3. WORK PACKAGES

Rules of engagement: isolated worktree per session; base on `main`; migration numbers AND kind ids chosen above both `origin/main` and the prod ledger with a fresh id-block + `ON CONFLICT (id) DO NOTHING`; full local gate (`pnpm format && pnpm lint && pnpm typecheck && pnpm css:check && pnpm build && pnpm --filter @exsto/legal-demo build && pnpm test:unit`) before push; the CI test list in package.json `test:unit` is EXPLICIT — add every new test file to it; NO raw substrate writes; prompts: keep firm facts in the STABLE cached prompt half.

### WP-A — Firm identity facts + the jurisdiction ladder (the keystone; do first)

> WP-A has two halves: **A1** (firm facts — the fallback rung) and **A2** (matter jurisdiction from intake — the primary rung). Ship A1 first (it unblocks everything), A2 immediately after in the same thread.

1. Migration (exsto-add-kind + exsto-substrate-migration): new `firm_profile` attribute kinds — `jurisdiction` (text; free-form like "North Carolina, US" but store a normalized short code alongside or parse; keep honest-null), `practice_areas` (json array of strings), `attorney_name` (text; migrate the legacy `tenant_settings.attorney_name` reading into firm_profile).
2. `tenantSettings.ts`: extend reads (`getFirmProfile`/`getTenantSettings`) + `setFirmProfile` to carry the new facts. Honest-missing discipline: absent jurisdiction ⇒ NO default — the prompts must degrade to "jurisdiction not set; ask the attorney / never assume" (mirror `getTenantSettingsForMerge`'s anti-forgery guard, `FIRM_DEFAULTS` must NOT grow).
3. Settings → Firm page: fields for jurisdiction, practice areas, attorney name.
4. Thread a single `FirmFacts` object (name, attorneyName, jurisdiction, practiceAreas — plus "unset" states) through:
   - `assistantChat.ts` SYSTEM_PROMPT: replace the Pacheco/NC first sentence with a templated firm line built from FirmFacts ("You are the AI assistant inside {firmName}'s practice app — {size/practice framing from facts}; the firm practices in {jurisdiction}"), de-NC the four examples (make them jurisdiction-neutral), rewrite the anti-stamping rule to reference "the firm's configured jurisdiction".
   - `assistantContext.ts`: `framing` built from FirmFacts (`Context: U.S. {jurisdiction} {practiceArea} firm` with honest fallbacks like "U.S. law firm") — this is the Perplexity string; keep it non-confidential.
   - `clientAssistantChat.ts`: "You are the {firmName} client portal assistant".
   - `reviseDraft.ts`: "under {jurisdiction} law" or omit the clause when unset.
   - `generateDraft.ts` / `generateEmail.ts` / `reviewDocument.ts`: replace literal `'NC'` with the firm's jurisdiction (both the substrate `jurisdiction:` payload stamps and every `resolveJurisdictionSkillSlugs` call). When unset: stamp null (knowability honest), pass undefined to the resolver (skills then match on document kind only — the resolver already treats jurisdiction as tie-break-only).
5. Tests: prompt builders parameterize correctly for a non-NC firm; unset facts degrade honestly (no "Pacheco", no "NC" anywhere in output); NC firm output unchanged (Pacheco continuity). Extend `assistant-acts.test.ts` patterns.
6. Backfill: seed Pacheco's firm_profile with jurisdiction "North Carolina, US", practice_areas ["business law"], attorney_name "Juan Carlos Pacheco" (migration seed or admin action) so behavior for the live firm is byte-equivalent after the switch.

**A2 — matter jurisdiction from the client's intake (the primary rung):**
1. New attribute kind `governing_jurisdiction` on the **matter** entity (definition row — exsto-add-kind; honest-null, provenance = the intake answer that set it).
2. Standard intake field: add `governing_jurisdiction` to the firm field library as a reusable questionnaire field id (a dropdown/text question like "Which state's law governs this? / Where is the property / business located?"). The build wizard (`firm-admin.build-service` skill + `intakeTemplateTools`) must be taught: **service shells are jurisdiction-AGNOSTIC** — never bake a state into a service name/template (the anti-stamping rule already exists; extend it), and when a service's legal content is jurisdiction-sensitive, the questionnaire SHOULD include the standard `governing_jurisdiction` question (the completeness check can nudge this).
3. Projection: on intake completion (the existing intake→matter projection path), write the answer to the matter's `governing_jurisdiction` attribute. Also settable/correctable by the attorney on the matter page (small field on the matter Overview or via chat action).
4. Resolution helper (ONE function, used everywhere): `resolveJurisdiction(ctx, { matterEntityId? }) → { value: string | null, source: 'matter' | 'firm' | 'unset' }` — matter attribute first, firm_profile fallback, null with 'unset' otherwise.
5. Consumers switch from FirmFacts.jurisdiction to the ladder: `generateDraft` / `generateEmail` / `reviewDocument` substrate stamps + `resolveJurisdictionSkillSlugs` (per-matter value); `reviseDraft` ("under {matter jurisdiction} law"); chat SYSTEM prompt matter blocks state the matter's governing jurisdiction when known and its SOURCE ("governing law: Texas, from the client's intake"); `assistantContext.ts` Perplexity framing uses the matter's jurisdiction on matter-scoped research, firm's on global. Templates already support `{{governing_jurisdiction}}` as a variable (templates are data) — thread the field id through the variable contract docs.
6. Tests: intake answer → matter attribute → drafting stamp + skill resolver receive the MATTER's jurisdiction even when it differs from the firm's; no intake answer → firm fallback with source 'firm'; neither → honest unset (prompt says jurisdiction not established, suggests asking the client); template token binds.

### WP-B — Custom instructions ("the firm can finally talk back")

1. Storage: `assistant_instructions` (firm-level, one text attribute on firm_profile or firm_settings) + per-attorney `assistant_settings.customInstructions` (extend the existing whole-JSON settings payload — no migration needed for the per-attorney half if it rides assistant_settings).
2. UI: Settings → Assistant (new sub-page): firm instructions (admin-editable) + "my instructions" (per-attorney); plus surface in the chat settings popover read-only with a link.
3. Injection: both blocks into `buildClaudeSystem`'s STABLE half under an explicit fenced header ("--- Firm instructions (follow unless they conflict with accuracy/safety rules) ---"), truncation-capped (~2k chars each); ALSO into `composeEmailDraft`'s prompt (email is where "always CC my paralegal" lives). Fence + injection-guard like the context fence.
4. Prompt-injection posture: instructions are attorney-authored (trusted-ish) but still fenced and subordinate to the accuracy/no-fabrication rules; say so in the prompt.
5. Tests: instructions present in system for chat + email paths; absent when unset; cap enforced.

### WP-C — De-Pacheco the shell

1. All §2.5 pages read the firm name from the request's resolved tenant (`resolvePublicTenant`/firm branding for public pages; `getFirmProfile` for authed pages; `app/layout.tsx` metadata generic — "Legal Instruments" product name, not a firm).
2. Kill the 5 duplicated `"NC LLC formation"` label functions → one shared humanize (service display names already exist per service — prefer reading the service's own `displayName`).
3. Sweep cosmetic placeholders opportunistically (grep list in §2.5).

### WP-D — Email prompt config seam

Give email drafting the same config-first shape documents have: per-tenant override for the email drafting prompt + house-voice doctrine (skill- or template-entity-backed like drafting prompts; `getDraftingPrompt` is the pattern), repo files demoted to fallback. Pacheco examples/name/NC line move into Pacheco's seeded content. Include: replace the "register exemplar" placeholder mechanism with a firm-suppliable exemplar field.

### WP-E — Close the cheap loops

1. Feed the persisted matter/client BRIEF into chat context when fresh (briefEngine staleness check already exists): prepend the brief to the context briefing and shrink the raw sections a depth notch — fewer tokens, better grounding.
2. Scope the skill catalog by firm practice_areas (from WP-A): filter `buildSkillCatalogText` to areas ∈ practiceAreas ∪ always-on (firm-admin, research, client-portal); keep `load_skill` able to load anything by slug (catalog filters discovery, not access).
3. Observations: add a reader — simplest is a section on Settings → AI usage listing recent `question_without_card` / `tool_cap` / `workflow_proposal_failed` counts.

### WP-F (later, design-first) — actual learning

- "Remember this" affordance → durable preference rows (per-attorney/per-firm) reviewable in Settings; injected with custom instructions.
- Distill revise/regenerate guidance notes into suggested preferences ("You've corrected X three times — save as a standing instruction?").
- Per-client approved-send exemplars replacing the static house-voice exemplar.
- Rolling per-matter conversation digest fed to new chats on the same matter.
- Skill management UI + automated reseed-on-deploy (content-hash the .md files, reseed changed slugs post-deploy).
- Decide fate of the dormant pgvector table (use for cross-matter semantic recall, or drop it).

### WP-G — Attorney tone learning ("write like me")

The raw material already sits in the substrate; nothing distills it.
1. **Exemplar harvest:** a per-attorney voice profile assembled from (a) sent emails the attorney authored themselves (communication_message rows where the sender is the attorney and the message was NOT AI-drafted — provenance distinguishes), (b) approved/edited drafts where the attorney's edit diverged from the AI draft (the edit IS the tone signal), (c) portal messages the attorney typed. Select a small, recent, diverse exemplar set (5–8, char-capped).
2. **Distillation:** a periodic (or on-demand) Haiku pass produces a compact per-attorney `voice_profile` (persisted like assistant_settings: greeting style, formality, sentence length, signoff, dos/don'ts observed) + keeps the raw exemplar refs. Regenerate when enough new authored material accumulates (count/staleness watermark like briefs).
3. **Injection:** voice profile + 2–3 verbatim exemplars into `composeEmailDraft`, the `compose_email` chat path, and `reviseDraft` — clearly fenced ("write in the attorney's own voice; these are their real messages"). House-voice doctrine remains the floor (bans still apply); the attorney's voice is the register. This finally replaces house-voice.md's placeholder exemplar mechanism.
4. **Controls:** Settings → Assistant shows the current voice profile (transparency), lets the attorney edit/pin/clear it, and toggle "match my tone" off.
5. Tests: profile assembly excludes AI-drafted sends; injection present/absent by toggle; cap enforced.

### WP-H — User-aware + the ATTENTION ENGINE (inbox, task triage, nothing slips)

Founder's ask, verbatim intent: *the assistant works as a task manager — "what are my most pressing tasks/matters to work on?" gets a real ranked answer; it checks the inbox; it reminds about overdue tasks and things that slipped through the cracks.*

1. **Attorney identity** in every turn's STABLE prompt: name (actor display_name / firm_profile attorney fallback), role, "you are speaking WITH {name}" — today the model serves an anonymous someone.
2. **The attention engine (deterministic, not a model guess):** one query module `attentionFeed(ctx, actorId)` that assembles, ranked, char-capped:
   - **Inbox**: unread / awaiting-reply client email threads (the mail workspace already models threads + participants; "awaiting reply" = last message inbound and no outbound since), unread portal messages.
   - **Overdue & due-soon tasks** (the task primitive has due dates; the calendar task-due feed from #366 already computes this — reuse the query, not the page).
   - **Slipped through the cracks**: matters with no activity in N days; matters parked on a human gate > N days (workflow stage age); drafts sitting in pending_review > N days; envelopes out unsigned > N days; invoices sent unpaid > N days; booking requests unconfirmed. Every threshold config-not-code (firm_settings defaults).
   - Each item carries WHY it surfaced + a deep link.
3. **Three delivery surfaces, one engine:** (a) **on-demand in chat** — "what's most pressing?" / "check my inbox" answers from the feed (global-scope volatile context + a `get_attention_feed` read tool so the model can pull it mid-conversation on any scope); (b) **the global-scope snapshot** — unscoped chat opens already knowing the top items (replaces today's context-null); (c) **proactive digest** — a scheduled worker job (the worker runtime + queueNotification routes already exist — the e-sign nudge pattern) that posts a morning attention digest in-app (notification bell) and optionally by email; per-attorney toggle + time in Settings → Assistant.
4. **Act on it:** triage answers pair with WP-I actions — "remind me Friday" (create task), "draft the reply" (compose_email), "nudge the client" (portal message/email) — so the answer to "what's pressing" is one click from handled.
5. Gap-check the client/matter rungs while there: contact-scope briefing parity with matter-scope, and ACTS-1 + WP-I tools registered on the right scopes.
6. Tests: feed module unit tests per bucket (fixtures: overdue task, stale matter, unanswered thread, unsigned envelope, unpaid invoice); ranking stable; thresholds read from config; global turn carries the snapshot; scoped turns unchanged (cache discipline: snapshot/feed in the volatile half); digest job idempotent per day.

### WP-I — Extensive action capabilities (the whole workspace acts in place)

Doctrine: the chat is a *front-end to the operation core*. Reads register freely; writes go through the house act-in-place patterns — either a **confirmation card** (like proposals: capture → card → the attorney's click executes) or a **real modal** (like compose/envelope: the surface IS the confirmation). Never a silent write from a model tool call.
1. **Inventory first:** enumerate the attorney MCP registry (`verticals/legal/src/mcp/index.ts`, ~50 tool files) and classify each tool read/write/scope. That's the authoritative to-wrap list; this brief's §2.9 list is the starting map.
2. **Wave 1 (highest daily value):** **inbox reads** (list unread/awaiting-reply threads, read a thread, then hand off to compose_email for the reply — pairs with WP-H's feed), tasks (create/complete/reschedule — "remind me Friday" is a task with a due date), notes (add to matter/client), calendar (create event / propose times — the googleCalendar adapter + booking rules exist), document request to client (portal request pipeline), matter open (replace the local chip walk with a real tool + card), workflow step ops (advance/skip/regenerate — Contract W routes exist; the step-runner modal is the confirmation surface).
3. **Wave 2:** invoices (draft invoice card → attorney sends), record manual payment, update contact/client fields, rates/booking/firm-settings changes (the known wrapper gap), transcript-extract + brief-generate on demand, cross-matter search ("which matters mention X" — needs a search read; consider the dormant pgvector here).
4. Each wave: ClientTool wrappers with capture→event→card/modal, scope-gated registration (matter/contact/global as appropriate), SYSTEM_PROMPT doctrine block per family (honesty rules: card ≠ done), turn persistence for re-render, driver-turn on completion (the ACTS-1 pattern throughout).
5. Tests: tool-scoping matrix (extend `assistant-acts.test.ts`), capture behavior per tool, no-silent-write property (every write tool's run() captures, never submits).

### Sequencing

WP-A (A1 then A2) is the keystone — everything downstream reads the FirmFacts + jurisdiction ladder. WP-B (custom instructions) and WP-C (de-Pacheco shell) are small and independent. WP-D (email config seam) unblocks WP-G's injection point — do D before G. WP-H is independent after A1. WP-I is the big one — run as its own multi-PR thread (inventory → wave 1 → wave 2), reusing ACTS-1 patterns. WP-E slots anywhere after A. WP-F items fold into G/H/I where they landed, remainder stays future. One PR per WP; A1+B may share a migration. New definition ROWS only (attribute kinds, field ids) — no new action kinds anticipated except possibly a `voice_profile` settings entity reusing the assistant_settings pattern.

---

## 4. VERIFICATION RECIPES

- **The two-firm test (the point of the whole thread):** with a second tenant whose firm_profile says e.g. "Texas / family law / Jane Smith": (1) chat turn → system prompt contains Texas/family-law framing, zero "Pacheco"/"NC"; (2) research turn → Perplexity framing says Texas; (3) draft + email → substrate payloads stamp the firm's jurisdiction, resolver gets it; (4) portal chat introduces itself with the right firm; (5) login/portal/pay/book/sign pages show the right name. With jurisdiction UNSET: prompts say jurisdiction-not-configured and never guess; stamps are null; nothing renders "Pacheco" or "NC".
- **The cross-jurisdiction client test (A2):** a Pacheco (NC) matter whose intake answered `governing_jurisdiction = "South Carolina"` → the draft/email/review stamps and skill resolution carry **South Carolina** (source 'matter'), the chat's matter block says "governing law: South Carolina, from the client's intake", and the matter's research framing says SC — the firm's NC never overrides the client's answer. A service built by the wizard carries NO state in its name/templates and includes the standard jurisdiction question when its content is jurisdiction-sensitive.
- **Tone (WP-G):** after the attorney has authored sends on file, a composed email's prompt carries their voice profile + real exemplars (AI-drafted sends excluded from harvest); toggle off → absent; the drafted text visibly shifts register between two attorneys with different profiles.
- **Attention engine (WP-H):** seed fixtures (overdue task, 10-day-stale matter, unanswered client thread, unsigned envelope, unpaid invoice) → "what are my most pressing tasks?" in a global chat returns exactly those, ranked, each with a why + link; "check my inbox" lists the awaiting-reply threads and can hand off to compose_email; the morning digest job produces one in-app notification per day with the same items.
- **Actions (WP-I):** every new write tool: model call → card/modal only (no substrate write until the attorney's click); tool-scoping matrix green; "remind me Friday to follow up with Riley" → task card → click → task exists with due date.
- **Pacheco continuity:** after WP-A backfill, a Pacheco turn's system prompt is semantically identical to today (facts now data-sourced).
- **Custom instructions:** set "always CC paralegal@… on client emails" at firm level → compose_email modal turn includes it in the prompt; email drafter honors it; unset → absent.
- **Gate:** the standard chain incl. `next build` + the explicit `test:unit` list; drive the app with the dev shim (`?demo_user=juan-carlos`) gently — the shared prod Supabase pooler exhausts at pool_size 15 under rapid headless loads (EMAXCONNSESSION); worktrees don't inherit untracked `.env.local` (copy from the main checkout).

## 5. KNOWN OPERATING GOTCHAS (inherited from prior threads)

- Deliver from an isolated git worktree; parallel sessions thrash the shared checkout.
- `tsc --noEmit` at root checks nothing (files:[]) — the real checks are `tsc -b` + `next build`; tests are not typechecked.
- Repo eslint has no react-hooks plugin — a `react-hooks/exhaustive-deps` disable comment is itself a lint error.
- Skills/prompts that live as substrate rows need a reseed after content changes — manual scripts, verify `valid_from` postdates the deploy.
- Prompt-cache discipline: firm facts and instructions belong in the STABLE system half; per-turn data in the volatile half.
- Merging to main auto-deploys (Netlify `exsto-law`); Claude merges directly per the standing operating model, but the classifier requires the user's explicit per-session ask for self-merge — get Joe's go-ahead.
- Beta feedback: claim (`legal.assistant.feedback_claim`) before working an item; `Beta-Feedback:` trailer; resolve on ship.
