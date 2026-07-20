// AI-CONTEXT C3 — token guard: a PRE-FLIGHT input-budget check for every chat
// turn assembled in api/assistantChat.ts and api/clientAssistantChat.ts, plus a
// fail-fast guard in front of callClaudeDrafter's single-call drafting path
// (adapters/claude.ts).
//
// WHY: nothing before this file estimated how many tokens a chat request would
// actually cost before sending it. Several independent char caps already exist
// — client-side history 100k (apps/legal-demo/components/UnifiedAssistantChat.tsx),
// server-side page-capture 16k (assistantChat.ts's MAX_PAGE_CONTENT_CHARS),
// client/matter context 12k (queries/clientContext.ts's
// CLIENT_CONTEXT_DEFAULT_BUDGET), attachments 60k/160k (assistantChat.ts's
// MAX_ATTACHMENT_CHARS / MAX_ATTACHMENTS_TOTAL_CHARS), forced skills ~16k —
// but none of them talk to each other, and none of them know the model's
// actual context window. Worst case: an Auto-routed turn lands on Haiku (the
// smallest window of the three tiers) while carrying max history + max
// attachments + a big page capture + a forced build-wizard skill — the
// independent caps can sum past what Haiku can accept, and the failure only
// surfaces as an opaque 400 from Anthropic AFTER the request is fully built
// (and, for drafting, after a real paid API round-trip).
//
// This module is PURE POLICY — no @anthropic-ai/sdk import, no network I/O —
// mirroring the module-boundary discipline of lib/modelRouter.ts (AI-CONTEXT
// C1) so adapters/claude.ts can import it (for assertDraftBudget) without a
// cycle: tokenGuard.ts imports ONLY modelRouter.ts, never adapters/claude.ts.

import { tierForModel, type ModelTier, type AiTask } from './modelRouter.js'

// ── Token estimation ────────────────────────────────────────────────────────
// Anthropic doesn't expose a local tokenizer cheap enough to run pre-flight on
// every turn, so we approximate from character count. General English prose
// averages roughly 4 chars/token; legal text runs denser — citations, defined
// terms, numbered clauses, punctuation-heavy boilerplate — which skews toward
// MORE tokens per char. 3.5 is a deliberately conservative divisor: it
// OVER-estimates tokens rather than under-estimates, which is the safe
// direction for a budget guard (trimming/tripping a little early costs
// nothing; under-estimating and letting a request through that the API then
// rejects is the failure mode this file exists to prevent).
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ── Ceilings ─────────────────────────────────────────────────────────────
// Every current Claude 4.x model (Haiku 4.5, Sonnet 4.6, Opus 4.8) has a 200K-
// token context window that bounds INPUT + OUTPUT together — a call whose
// (estimated input) + max_tokens exceeds the window is rejected by the API.
// INPUT_CEILING_BY_TIER is the ceiling on ESTIMATED INPUT ALONE, per tier,
// BEFORE guardChatBudget/assertDraftBudget reserve the call's own max_tokens
// off it (see below):
//   - haiku: 180_000 — Haiku is where the worst case actually lands. Auto
//     routes ordinary conversational turns to Haiku (modelRouter's
//     chooseAutoModel), and an "ordinary" turn can still carry max history +
//     max attachments + a full page capture + a forced skill — nothing about
//     being the cheap tier makes a turn small. 180K reserves real headroom
//     under the 200K window for output and for this estimator's own
//     conservative slop.
//   - sonnet/opus: 200_000 — the policy ceiling is the window itself. Sonnet
//     is the ESCALATION target specifically BECAUSE an input is large/heavy
//     (modelRouter's transcript_extract/service_digest escalate past
//     300K/100K inputChars; chooseAutoModel escalates Auto to Sonnet past 60K
//     history chars) — pushing its practical ceiling down further would
//     defeat the point of escalating to it. The call's real max_tokens is
//     still reserved off this ceiling, which is what actually bounds output.
export const INPUT_CEILING_BY_TIER: Record<ModelTier, number> = {
  haiku: 180_000,
  sonnet: 200_000,
  opus: 200_000,
}

function ceilingForCall(model: string, maxTokens: number): { tier: ModelTier; ceiling: number } {
  const tier = tierForModel(model)
  const reservedForOutput = Math.max(0, Math.floor(maxTokens) || 0)
  return { tier, ceiling: Math.max(0, INPUT_CEILING_BY_TIER[tier] - reservedForOutput) }
}

// ── Volatile page-capture clipping ──────────────────────────────────────────
// The live screen-capture block that api/assistantChat.ts's
// buildVolatileClaudeSystem fences with these markers. Owned HERE (not in
// assistantChat.ts) and imported the other way around — assistantChat.ts
// pulls them from this module — so guardChatBudget can locate and further
// clip the fenced span without assistantChat.ts importing FROM tokenGuard.ts
// AND tokenGuard.ts importing back FROM assistantChat.ts (the exact cycle
// this module's header warns against).
export const SCREEN_BEGIN = '«BEGIN SCREEN»'
export const SCREEN_END = '«END SCREEN»'
// Matches the "…[truncated]" suffix assistantChat.ts's own MAX_PAGE_CONTENT_CHARS
// clip already appends, so a doubly-clipped capture (their 16k cap, then ours on
// top when the turn is still over budget) reads identically to a singly-clipped
// one — never a stutter like "…[truncated] …[truncated]".
const PAGE_TRUNCATION_MARKER = ' …[truncated]'

// Clip the fenced page-capture content inside `volatile` down to at most
// `maxContentChars`. Returns the input UNCHANGED (same string) when there is no
// fenced block, or the content is already at or under the target — so callers
// can tell "nothing to clip" from "clipped" by reference/value equality.
function clipPageCaptureInVolatile(
  volatile: string,
  maxContentChars: number,
): { text: string; clippedToChars?: number } {
  const beginMarker = `${SCREEN_BEGIN}\n`
  const beginIdx = volatile.indexOf(beginMarker)
  if (beginIdx === -1) return { text: volatile }
  const contentStart = beginIdx + beginMarker.length
  const endMarker = `\n${SCREEN_END}`
  const endIdx = volatile.indexOf(endMarker, contentStart)
  if (endIdx === -1) return { text: volatile }

  const content = volatile.slice(contentStart, endIdx)
  const cap = Math.max(0, Math.floor(maxContentChars))
  if (content.length <= cap) return { text: volatile }

  const base = content.endsWith(PAGE_TRUNCATION_MARKER)
    ? content.slice(0, -PAGE_TRUNCATION_MARKER.length)
    : content
  const clippedBody = base.slice(0, cap).trimEnd()
  const clipped = `${clippedBody}${PAGE_TRUNCATION_MARKER}`
  return {
    text: volatile.slice(0, contentStart) + clipped + volatile.slice(endIdx),
    clippedToChars: clippedBody.length,
  }
}

// ── Chat budget guard ────────────────────────────────────────────────────
export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatBudgetParts {
  // The STABLE half of the system prompt (buildClaudeSystem's output) — base
  // prompt + matter/client context + skill catalog + FORCE-LOADED skill bodies
  // (activeSkillsText, folded into the same string by buildClaudeSystem). This
  // and userMessage are the two pieces guardChatBudget NEVER trims.
  systemStable: string
  // The VOLATILE half (buildVolatileClaudeSystem's output) — build brief +
  // current route + the fenced live page capture. Only the fenced page-capture
  // PORTION is ever clipped, and only as the last resort (trim step 2).
  volatile: string
  // Prior turns, oldest-first. Trimmed from the front (step 1) — see
  // trimHistoryOldestFirst for the monotonicity guarantee this relies on.
  history: HistoryTurn[]
  // The current user turn, already assembled (attachments appended, etc).
  // NEVER trimmed.
  userMessage: string
  // The concrete Claude model id this turn is calling (post Auto-resolution).
  model: string
  // The max_tokens this call will request — reserved off the tier ceiling so
  // input + output never exceeds the model's real context window.
  maxTokens: number
}

export interface ChatBudgetResult {
  systemStable: string
  volatile: string
  history: HistoryTurn[]
  userMessage: string
  // Count of whole history turns dropped from the front to fit budget. 0 when
  // nothing needed trimming.
  droppedHistoryTurns: number
  // Present only when the page-capture portion of volatile was clipped BEYOND
  // its own existing MAX_PAGE_CONTENT_CHARS cap — the char length it was
  // clipped down to.
  volatileClippedToChars?: number
  // Best-effort estimate of the FINAL (possibly trimmed) request's input
  // tokens — for logging/telemetry, not a hard guarantee against the live API.
  estimatedInputTokens: number
}

// Whole-turn, oldest-first, MONOTONIC trim: given each turn's fixed size and a
// budget, keep the longest SUFFIX of `history` whose total size fits.
// Monotonicity — the property C2's prompt cache depends on — falls out of the
// algorithm's shape: it is a pure function of (history, budget) with no
// dependence on anything outside those two arguments, so for any history H and
// its extension H' = H + [newTurns...] evaluated against the SAME budget, the
// survivor start index for H' is always >= the survivor start index for H
// (appending content can only ADD pressure on the budget, never relieve it).
// A turn that already fell out of the window never comes back, and a turn
// still inside it keeps the exact same bytes — see
// tests/vertical/token-guard.test.ts's monotonicity + joint trim×cache tests.
function trimHistoryOldestFirst(
  history: HistoryTurn[],
  tokenBudget: number,
): { survivors: HistoryTurn[]; dropped: number } {
  if (tokenBudget <= 0) return { survivors: [], dropped: history.length }
  let start = history.length
  let running = 0
  for (let i = history.length - 1; i >= 0; i--) {
    running += estimateTokens(history[i]!.content)
    if (running > tokenBudget) break
    start = i
  }
  return { survivors: history.slice(start), dropped: start }
}

// Pre-flight budget check + deterministic trim for one chat turn's assembled
// parts. Trim order (never deviates): (1) drop OLDEST history turns first,
// whole turns; (2) clip the page-capture portion of volatile. `systemStable`
// (which carries forced skills — see ChatBudgetParts) and `userMessage` are
// NEVER trimmed.
//
// Step 1's budget is computed against volatile at its FULL (untrimmed) size,
// so history trimming never depends on whether volatile later gets clipped —
// each step's outcome is a pure function of the ORIGINAL inputs, which is what
// keeps the whole function deterministic and history trimming specifically
// monotonic turn-to-turn (see trimHistoryOldestFirst).
export function guardChatBudget(parts: ChatBudgetParts): ChatBudgetResult {
  const { ceiling } = ceilingForCall(parts.model, parts.maxTokens)

  const systemTokens = estimateTokens(parts.systemStable)
  const userTokens = estimateTokens(parts.userMessage)
  const fixedTokens = systemTokens + userTokens
  const volatileTokensFull = estimateTokens(parts.volatile)
  const historyTotalFull = parts.history.reduce((n, t) => n + estimateTokens(t.content), 0)
  const totalFull = fixedTokens + volatileTokensFull + historyTotalFull

  if (totalFull <= ceiling) {
    return {
      systemStable: parts.systemStable,
      volatile: parts.volatile,
      history: parts.history,
      userMessage: parts.userMessage,
      droppedHistoryTurns: 0,
      estimatedInputTokens: totalFull,
    }
  }

  // Step 1 — drop oldest history first.
  const historyBudget = Math.max(0, ceiling - fixedTokens - volatileTokensFull)
  const { survivors, dropped } = trimHistoryOldestFirst(parts.history, historyBudget)
  const survivorHistoryTokens = survivors.reduce((n, t) => n + estimateTokens(t.content), 0)

  // Step 2 — even with all trimmable history dropped, still over budget: clip
  // the page-capture portion of volatile down to whatever room is left.
  let volatileOut = parts.volatile
  let volatileClippedToChars: number | undefined
  let volatileTokens = volatileTokensFull
  const afterHistoryTrimTotal = fixedTokens + volatileTokensFull + survivorHistoryTokens
  if (afterHistoryTrimTotal > ceiling) {
    const overBy = afterHistoryTrimTotal - ceiling
    const targetVolatileTokens = Math.max(0, volatileTokensFull - overBy)
    const targetChars = Math.floor(targetVolatileTokens * CHARS_PER_TOKEN)
    const clip = clipPageCaptureInVolatile(parts.volatile, targetChars)
    volatileOut = clip.text
    volatileClippedToChars = clip.clippedToChars
    volatileTokens = estimateTokens(volatileOut)
  }

  return {
    systemStable: parts.systemStable,
    volatile: volatileOut,
    history: survivors,
    userMessage: parts.userMessage,
    droppedHistoryTurns: dropped,
    volatileClippedToChars,
    estimatedInputTokens: fixedTokens + volatileTokens + survivorHistoryTokens,
  }
}

// ── Drafter fail-fast guard ──────────────────────────────────────────────
// Thrown by assertDraftBudget. Actionable: names the task, the estimate, and
// the ceiling, so a server drafting call fails BEFORE the paid Anthropic
// round-trip instead of surfacing as a bare 400 after it.
export class DraftBudgetExceededError extends Error {
  constructor(
    public readonly task: AiTask,
    public readonly estimatedTokens: number,
    public readonly ceiling: number,
    public readonly model: string,
  ) {
    super(
      `AI task "${task}" estimates ~${estimatedTokens.toLocaleString()} input tokens against a ` +
        `${ceiling.toLocaleString()}-token ceiling for ${model}. Shorten the input (fewer or ` +
        `shorter attachments, a narrower transcript/document range) and try again.`,
    )
    this.name = 'DraftBudgetExceededError'
  }
}

// Single-call drafting (callClaudeDrafter) has no history/volatile to trim —
// it sends ONE user-role prompt string that the caller assembled for a reason
// (drafting instructions + the source document/transcript). There's nothing
// safe to trim automatically the way chat's history/page-capture are — cutting
// into it could drop the actual instructions or the document being reviewed —
// so this FAILS FAST instead: before the API call, not after paying for a
// round-trip Anthropic would reject anyway.
export function assertDraftBudget(
  task: AiTask,
  prompt: string,
  model: string,
  maxTokens: number,
): void {
  const { ceiling } = ceilingForCall(model, maxTokens)
  const estimated = estimateTokens(prompt)
  if (estimated > ceiling) {
    throw new DraftBudgetExceededError(task, estimated, ceiling, model)
  }
}
