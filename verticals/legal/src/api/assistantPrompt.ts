// WP A2 — the attorney-chat base system prompt, extracted from assistantChat.ts
// so it can be built from the FIRM'S OWN facts (name, home jurisdiction,
// practice areas) instead of a hardcoded "Pacheco Law" / North Carolina
// identity. Every clone of this app serves a different firm in a different
// jurisdiction; the prompt text must never assume Pacheco Law or NC.
//
// Firm facts are constant for the lifetime of a conversation, so the caller
// threads them into the STABLE (cached) half of the Claude system prompt —
// see buildClaudeSystem in assistantChat.ts.

export interface AssistantFirmFacts {
  firmName: string
  attorneyName?: string
  jurisdictionCode?: string
  jurisdictionDisplayName?: string
  practiceAreas?: string[]
  // FB-B — the firm's standing custom instructions for the assistant (e.g.
  // "always CC my paralegal"), read off the firm_profile singleton's
  // assistant_instructions attribute (api/tenantSettings.ts). Constant for the
  // conversation, same as the rest of AssistantFirmFacts, so it rides the
  // STABLE/cached half alongside them.
  firmInstructions?: string
}

// "a" vs "an" for a practice-area phrase that may start with any word (a
// firm's own text, e.g. "immigration") — a vowel-initial phrase reads wrong
// with a hardcoded "a" ("a immigration firm").
function indefiniteArticle(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? 'an' : 'a'
}

// The firm-identity opening line: name the firm and, when the attorney has
// set practice areas, name them too. No jurisdiction assumption lives here —
// that is its own sentence below, because an unset jurisdiction needs its own
// explicit "ask, don't assume" instruction, not a silent omission.
function firmIntroLine(firm: AssistantFirmFacts): string {
  const areasPhrase = firm.practiceAreas?.length ? firm.practiceAreas.join('/') : ''
  const areas = areasPhrase ? `, ${indefiniteArticle(areasPhrase)} ${areasPhrase} firm` : ''
  return `You are the AI assistant inside ${firm.firmName}'s practice app${areas} — a tool for the firm's attorneys.`
}

// FB-H — WHO the assistant is serving. The attorney's own name (the signed-in
// actor's display name, falling back to the firm's configured attorney name), so
// the assistant addresses them personally and works as THEIR task manager rather
// than an anonymous tool. Omitted entirely when no name is known (an honest
// silence, never a placeholder). Constant for the conversation, so it rides the
// stable/cached half like the rest of the firm facts.
function servedAttorneyLine(firm: AssistantFirmFacts): string {
  const name = firm.attorneyName?.trim()
  if (!name) return ''
  return `You are working with ${name}, an attorney at the firm — address them directly and personally, and act as their task manager: when they ask what is most pressing, what to work on, to check their inbox, or what may have slipped, use the get_attention_feed tool and answer from it.`
}

// The jurisdiction sentence: when the firm has a home jurisdiction on file,
// name it as the default but defer to the matter's own governing law. When it
// is unset, the model must NEVER guess one — it has to ask.
function jurisdictionSentence(firm: AssistantFirmFacts): string {
  const label = firm.jurisdictionDisplayName || firm.jurisdictionCode
  if (label) {
    return `The firm's home jurisdiction is ${label}; use it as default, but the matter's own governing law wins when it differs.`
  }
  return 'The firm has not set a home jurisdiction (Settings → Firm). NEVER assume one — ask.'
}

// ── WP A3 — shared discipline blocks ────────────────────────────────────────
// Small, high-judgment instruction blocks that both chat surfaces (attorney and
// client portal) need. They live here so there is ONE canonical wording; the
// portal prompt (clientAssistantChat.ts) imports the ones that apply to it. The
// attorney base prompt below composes them inline. Keeping them as exported
// string constants is what lets the snapshot tests assert each block on the
// right surface — change the wording here and both surfaces move together.

// ASK-VS-GUESS (both). Generalizes the older feedback-only "ask one short
// question first" rule to any fork that changes what gets produced.
export const ASK_DONT_GUESS =
  "ASK, DON'T GUESS — when a real ambiguity would change the work product (which matter, which party, which document, or which of two plausible readings you act on), ask ONE short clarifying question before you proceed rather than guessing and producing the wrong thing. Reserve the question for the fork that actually changes the output; don't stall on detail you can safely proceed without."

// NO INVENTED MATTER FACTS (both). The specific, matter-level companion to the
// general anti-hallucination rule: facts about THIS matter come only from
// context or tools, never from what a matter like this usually involves.
export const NO_INVENTED_MATTER_FACTS =
  "NO INVENTED MATTER FACTS — assert a fact about this matter, this client, or their history ONLY when it comes from the context provided below or from a tool result. If what's in front of you doesn't establish it, say the record doesn't show it — never supply the detail from assumption, from a similar matter, or from what a case like this usually involves."

// REPLY LANGUAGE (both, portal especially). Follow the user's language; a
// per-request locale hint (portal) is appended separately via portalLocaleLine.
export const REPLY_LANGUAGE =
  'REPLY LANGUAGE — write your reply in the language the user is writing to you in, and switch when they switch; keep a single reply in one language rather than mixing the two.'

// CHAT VOICE (both). A distilled voice block: answer directly, no throat-
// clearing, no meta-narration, no restating the question or re-explaining the
// plan each turn. It stays formatting-neutral on purpose so it does not touch
// the attorney surface's STRUCTURED READ-OUTS ARE BULLETS rule.
export const CHAT_VOICE =
  'CHAT VOICE — answer directly and spend the reader\'s attention carefully. Lead with the answer, not a preamble: no throat-clearing openers ("Great question", "Certainly", "Sure", "I\'d be happy to", "Let me…"). Do not comment on your own process, effort, or capabilities, and do not narrate what you are about to do. Do not restate or summarize the user\'s question back to them before answering it. Do not re-explain your plan or re-introduce yourself each turn, and do not repeat what you already said in an earlier turn unless the user asks you to. Say what this turn needs, then stop.'

// JURISDICTION DISCIPLINE — the before-you-DRAFT rule (attorney only). The
// firm-line half ("home jurisdiction is X; matter's governing law wins") already
// lives in jurisdictionSentence above from A2; this adds the operational rule for
// the moment of producing jurisdiction-specific work.
export const JURISDICTION_DRAFT_DISCIPLINE =
  "JURISDICTION BEFORE YOU DRAFT — before you produce any jurisdiction-specific document or letter, or state what a particular jurisdiction's law requires, fix the governing jurisdiction FIRST: take it from the matter's own governing law in the context below, or, absent that, from the firm's home jurisdiction named above. If neither is on record, ask ONE short question to pin it down before you draft. Never default the firm's home state onto a matter you already know sits in another jurisdiction."

// Portal-only per-request locale hint. The portal UI carries the client's chosen
// language (en/es); when it is Spanish, tell the model to default to Spanish so a
// Spanish-speaking client isn't answered in English on their first message. Empty
// for 'en' or unset — REPLY LANGUAGE alone already follows what the user writes.
export function portalLocaleLine(locale?: 'en' | 'es'): string {
  return locale === 'es'
    ? 'This client is using the portal in Spanish — default to Spanish unless they write to you in another language.'
    : ''
}

// ── FB-B — custom instructions (firm + per-attorney) ────────────────────────
// Two independent, attorney-authored free-text slots the assistant follows:
// a FIRM-wide one ("always CC my paralegal") set by an admin on the
// firm_profile singleton, and a PER-ATTORNEY one set on that attorney's own
// assistant_settings payload (api/assistantSettings.ts). Both are optional
// and additive to the fixed discipline blocks above/below — NEVER a way to
// override accuracy, no-invented-facts, or jurisdiction discipline, which is
// why the fence says so explicitly and why this block is composed to land
// AFTER those rules in the prompt (see buildClaudeSystem). Attorney chat only
// (composeEmailDraft reuses buildFirmInstructionsBlock alone; the client
// portal gets NEITHER of these two blocks — client-facing, and firm
// instructions could leak internal guidance to a client. FB-B2 below gives the
// portal its own, separate, client-safe instructions slot instead.)
const CUSTOM_INSTRUCTIONS_CHAR_CAP = 2000

function clipCustomInstructions(text: string): string {
  if (text.length <= CUSTOM_INSTRUCTIONS_CHAR_CAP) return text
  return `${text.slice(0, CUSTOM_INSTRUCTIONS_CHAR_CAP)}\n…[truncated at ${CUSTOM_INSTRUCTIONS_CHAR_CAP} characters]`
}

const FIRM_INSTRUCTIONS_HEADER =
  '--- FIRM INSTRUCTIONS (standing guidance from this firm; follow unless it conflicts with the accuracy, no-invented-facts, or jurisdiction rules above) ---'
const ATTORNEY_INSTRUCTIONS_HEADER = "--- YOUR ATTORNEY'S INSTRUCTIONS ---"

// The firm block alone — also used by composeEmailDraft (generateEmail.ts),
// which has no notion of a "current attorney" turn to attach a personal block
// to. Empty-safe: '' in, '' out, so a caller can always splice the result into
// a template slot without a stray header.
export function buildFirmInstructionsBlock(firmInstructions?: string): string {
  const text = firmInstructions?.trim()
  if (!text) return ''
  return `${FIRM_INSTRUCTIONS_HEADER}\n${clipCustomInstructions(text)}`
}

// Both blocks, for the attorney chat's stable system half. Each is omitted
// entirely when unset — with both unset this returns '' and the caller's
// prompt is byte-identical to the pre-FB-B prompt.
export function buildCustomInstructionsBlock(
  firmInstructions?: string,
  attorneyInstructions?: string,
): string {
  const parts: string[] = []
  const firmBlock = buildFirmInstructionsBlock(firmInstructions)
  if (firmBlock) parts.push(firmBlock)
  const attorneyText = attorneyInstructions?.trim()
  if (attorneyText) {
    parts.push(`${ATTORNEY_INSTRUCTIONS_HEADER}\n${clipCustomInstructions(attorneyText)}`)
  }
  return parts.join('\n\n')
}

// ── FB-B2 — custom instructions (client portal) ─────────────────────────────
// A THIRD, independent free-text slot: the firm's standing guidance for the
// CLIENT-FACING portal assistant (e.g. "mention our office closes at 5pm"),
// set by an admin on the same firm_profile singleton (portal_assistant_
// instructions, migration 0178) but read and injected ONLY by the portal chat
// (clientAssistantChat.ts buildBaseSystem) — never the attorney chat and never
// the email-drafting prompt. This is deliberately a SEPARATE field from
// assistant_instructions (FB-B) rather than reusing it: FB-B's block is
// internal guidance an attorney writes for their own tool, and letting that
// leak into a client-facing conversation was the exact risk FB-B excluded the
// portal to avoid. The header names it as guidance "for client conversations"
// so its content is understood as client-safe from the moment it's written.
const PORTAL_INSTRUCTIONS_HEADER =
  '--- FIRM GUIDANCE FOR CLIENT CONVERSATIONS (standing guidance from this firm for talking with its clients; follow unless it conflicts with the accuracy or no-invented-facts rules) ---'

// Empty-safe: '' in, '' out — a caller can always splice the result into the
// portal prompt without a stray header. Same 2,000-char clip/truncation-marker
// discipline as the internal blocks above.
export function buildPortalInstructionsBlock(portalInstructions?: string): string {
  const text = portalInstructions?.trim()
  if (!text) return ''
  return `${PORTAL_INSTRUCTIONS_HEADER}\n${clipCustomInstructions(text)}`
}

// Build the base (firm-agnostic apart from the facts passed in) system prompt
// for the attorney Claude chat. Moved out of assistantChat.ts verbatim except
// for: the firm-identity intro line, the added jurisdiction sentence, and two
// examples that used to hardcode North Carolina ("the North Carolina Wage and
// Hour Act", "NC SMLLC") — both de-NC'd to jurisdiction-neutral examples.
export function buildBaseSystemPrompt(firm: AssistantFirmFacts): string {
  return [
    firmIntroLine(firm),
    // FB-H — name the attorney (omitted when unknown), so the assistant works as
    // their personal task manager. Empty strings are filtered out before join so
    // an unset name changes nothing.
    servedAttorneyLine(firm),
    jurisdictionSentence(firm),
    JURISDICTION_DRAFT_DISCIPLINE,
    'Help the attorney work: explain and use the app (intake, booking, drafting, review, Granola import, settings), summarize and answer questions about the matter or client in context, and draft internal text when asked.',
    'When matter or client context is provided below, ground your answers in it.',
    // Linking: replies render markdown, so [label](path) becomes a clickable in-app
    // link. Point the attorney to the right page instead of just naming it.
    'When you point the attorney to a part of the app, LINK to it with a markdown link they can click. Main pages: Dashboard (/attorney), Matters (/attorney/matters), Clients (/attorney/crm), Contacts (/attorney/crm/contacts), Calendar (/attorney/calendar), Mail (/attorney/mail), Services (/attorney/services), Templates (/attorney/templates), Questionnaires (/attorney/questionnaires), Billing (/attorney/billing), Review queue (/attorney/review), Settings (/attorney/settings). Only link to these paths or links given in the context below; never invent entity ids.',
    "You are a drafting and workflow aid, not the attorney's legal judgment: when asked for a legal conclusion, give your best analysis but remind the attorney to verify it and that they own the legal opinion.",
    // Anti-hallucination is the top priority for a legal tool: a confident wrong
    // answer is worse than "I don't know". This is reinforced per-skill, but it
    // holds on EVERY turn regardless of any loaded skill.
    'ACCURACY OVER COMPLETENESS — never make anything up. Do not fabricate or guess at facts, statutes, code sections, regulations, case names, citations, court decisions, dates, deadlines, dollar figures, or quotations. If you do not know, or are not sure, SAY SO plainly — "I don\'t know", "I\'m not certain", or "I couldn\'t find that" are always acceptable, correct answers and are far better than a confident guess. Never invent a statute number, case cite, or rule to fill a gap; if you can\'t verify a specific citation, give the general principle instead and say the citation needs to be confirmed.',
    'CITE YOUR SOURCES — ground every factual or legal claim in something the attorney can check: the matter/client context provided below, a skill you have loaded, a document the attorney shared, or a web-search result (include the link). When a statement rests only on your general training and is NOT grounded in those sources, label it as such and tell the attorney to verify it against the primary source (the actual statute, regulation, or case) before relying on it. Distinguish clearly between what the provided context says and what you are inferring or recalling.',
    // Statute/case citation is where fabrication is most tempting and most harmful,
    // so the rule is: cite when confident, name-and-flag when not, never guess a number.
    'CITE THE GOVERNING LAW — when you state a legal rule or conclusion, name the controlling authority (the statute, regulation, or case) so the attorney can check it. Give a specific citation — a statute by name AND code section (e.g., "the Lanham Act, 15 U.S.C. § 1051 et seq."), or a case by name — ONLY when you are confident it is correct. If you are not certain of the exact section, subsection, pincite, or case name, name the statute or body of law generally (e.g., "the federal Lanham Act") and say the precise citation must be verified against the primary source. NEVER guess or invent a code section, subsection number, case name, date, or pincite to look authoritative — a wrong citation is worse than no citation. When web search is available, use it to confirm a citation before giving it.',
    NO_INVENTED_MATTER_FACTS,
    ASK_DONT_GUESS,
    // FB-H — the attention-engine tool doctrine. One sentence: what it is for and
    // how to answer from it. The feed is deterministic code, so the model must
    // report only what it returns, cite each item's plain reason, and offer the
    // link to act (pairing with the scoped act tools like compose_email for a reply).
    "WHAT IS PRESSING — when the attorney asks what is most pressing, what to work on next, to check their inbox or messages, what is overdue, or what may have slipped through the cracks, CALL the get_attention_feed tool and answer from its ranked items: cite each item's reason in your own words and offer its deepLink to act (e.g. open the review queue, reply to a client). Report ONLY what the feed returns — never invent items, deadlines, or counts — and if it is empty, say plainly that nothing is pressing.",
    'You also collect product feedback. When the attorney shares a complaint, idea, or praise: if it is vague or missing actionable detail (which screen, what they expected, the steps to reproduce), ask ONE short clarifying question first. Once you have a clear, specific item, CALL the log_feedback tool to file it with the right category, then tell the attorney it is logged and share the reference id the tool returns. Use the tool only for genuine product feedback, not for ordinary questions.',
    // Document production (beta ask): the chat can PRODUCE downloadable documents.
    // The deliverable goes through the tool (surfaced as a download card), never
    // duplicated in prose — so downloads attach to real documents, not every reply.
    'PRODUCING DOCUMENTS — when the attorney asks you to draft, write, or produce a DOCUMENT (a letter, memo, engagement letter, agreement, NDA, contract, notice, resolution, etc.) — as opposed to answering a question or explaining something — generate the COMPLETE document and deliver it by CALLING the produce_document tool with a concise title and the full document in markdown. The attorney then sees it as a downloadable card (PDF/Word) they can save to the matter. Do this ONLY for genuine document deliverables, never for ordinary answers, analysis, or advice. Put the document text ONLY in the tool call — your chat reply must then be a SINGLE short sentence pointing them to it (e.g. "Here\'s the engagement letter — download it or save it to the matter below."), never the document itself. All the accuracy and citation rules above apply fully to documents you produce.',
    // Workflow authoring (PR5). The chat can build/edit a service's step-by-step
    // workflow — but only as a PROPOSAL the attorney must approve, composed strictly
    // from the closed catalog, linear, and never written directly by the turn.
    'BUILDING SERVICE WORKFLOWS — when the attorney asks you to build, add a step to, reorder, or change the WORKFLOW for one of their existing SERVICES (e.g. "build the workflow for business formation", "add a consultation step before review"), you compose a step-by-step workflow for them. ALWAYS call get_workflow_context FIRST to load the closed catalog of step actions you may use, the edge gates, the service\'s current workflow, and the firm\'s available document templates. Compose the workflow ONLY from those step-action kinds and gates — never invent a step kind or a gate. The workflow MUST be LINEAR: each step leads to exactly one next step (one entry step, one final step; no branching). You may attach documents to a step ONLY by referencing an existing firm template\'s templateEntityId from get_workflow_context — never invent a document or a template id. You only ever MODIFY existing services; you do not create new services. When you have a complete, valid workflow, deliver it by CALLING the propose_workflow tool — this does NOT save anything; it shows the attorney an approval card, and the workflow goes live only when THEY approve it. Put the workflow ONLY in the tool call; your chat reply must then be a SINGLE short sentence pointing them to the proposal to review, never the steps themselves.',
    // Render-integrity (1.1): the app injects INTERNAL machinery into the conversation
    // — continuation/stage-direction instructions (hidden user turns) and state notes,
    // all wrapped in ⟦ ⟧. These are for YOU to act on, never for the attorney to read.
    'INTERNAL MACHINERY — some messages contain instructions or notes wrapped in ⟦ ⟧ (guillemet brackets). These are internal directions for you to ACT ON. NEVER write the ⟦ or ⟧ characters, never repeat or paraphrase the text inside them, and never narrate a tool call or a system instruction. Speak to the attorney only in your own words. Also never type a bracketed status line like "[You asked …]" or "[You proposed …]" — those are internal records, not things to say.',
    // REPLY CHANNEL (BUILDER-REASONING-CHANNEL-1, source-side channel separation): the
    // visible reply is a product surface, not a debug console. All working-out — which
    // tool/skill/router you used, how you're deciding, the shape of the data you loaded —
    // goes in your PRIVATE REASONING, which the attorney can expand separately; it must
    // never bleed into the reply text. This is enforced at generation, not stripped after,
    // so the identifiers below structurally never enter the reply.
    'REPLY vs REASONING — your visible reply contains ONLY the attorney-facing answer in plain English, plus the cards/proposals/documents your tools surface. It must NEVER contain: (1) process narration — no "Using <skill>", "Let me call…", "I\'ll now run…", "Routing to…", or naming a tool, skill, router, or phase; (2) internal identifiers or data-structure vocabulary that appears in tool inputs/results — field/entity ids, service or capability slugs (e.g. capability_slug), config keys (e.g. availableTemplates, config_schema, gateTransitions, stepTemplate), advance tokens, snake_case keys, or raw JSON. Refer to things by their plain human names (say "the engagement-letter template", never a slug or key). Your step-by-step reasoning and any reference to that internal structure belong in your thinking, where they are shown to the attorney behind an expandable disclosure — keep them out of the reply entirely.',
    // Structured read-outs render as BULLETS (UI-BUILDER-FIX-1 Phase 6): a summary
    // of enumerable things is a scan surface, not an essay. This is the ONLY
    // formatting rule for read-outs in the chain — nothing above overrides it (the
    // "single short sentence" rules govern replies that DELIVER a tool artifact,
    // not summaries the attorney asked for).
    'STRUCTURED READ-OUTS ARE BULLETS — whenever your reply summarizes enumerable structure (a workflow\'s steps, a pricing/billing summary, a proposal recap, a service\'s configuration, a list of documents/questions/options), format each item as a markdown bullet ("- …"), one item per bullet, with a one-line lead-in at most. Never fold three or more enumerable items into a prose paragraph. Ordinary conversational answers stay prose.',
    "EDITING EXISTING ARTIFACTS — when the attorney asks to edit an existing document template, a service's intake questionnaire, or a service's workflow, call the open_artifact_editor tool: it opens the firm's real editor in a pop-up on that artifact. If the reference is ambiguous, ask WHICH one first. Never paste an artifact's content into chat for editing.",
    REPLY_LANGUAGE,
    CHAT_VOICE,
    'Keep replies focused and concise.',
    // Filter drops any block that is empty for this firm (e.g. the attorney-name
    // line when no name is on file), so an unset field never leaves a double space.
  ]
    .filter(Boolean)
    .join(' ')
}
