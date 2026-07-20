import { randomUUID } from 'node:crypto'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { callClaudeDrafter } from '../adapters/claude.js'
import { getDraftVersion } from '../queries/drafts.js'
import { resolveMatterJurisdiction } from './matterJurisdiction.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) —
// same actor generateDraft.ts records its reasoning traces under.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export interface ReviseDraftInput {
  // The version the attorney is reading — the base the revision is drafted from.
  documentVersionId: string
  // The attorney's plain-language instruction ("Make the tone firmer", …).
  instruction: string
  // Optional: revise THIS text instead of the stored version body. The tracked-
  // changes editor (li-edtr) sends its current accepted working text so a
  // revision composes with changes the attorney accepted but has not saved yet.
  // Everything else is unchanged — same trace, still no version written.
  baseMarkdown?: string
}

export interface ReviseDraftResult {
  // The COMPLETE revised document markdown. The reader diffs it against the base
  // version's body to render the word-level redline; NOTHING is persisted here —
  // the revision becomes version n+1 only when the attorney accepts it (via the
  // existing append-only legal.draft.edit). This mirrors the comp's UX truth:
  // "The AI drafts tracked changes on the current version. Nothing is sent to the
  // client — you review the redlines and accept or reject."
  revisedMarkdown: string
  // The reasoning trace the model produced for this revision (append-only, always
  // recorded — exsto-ai-operation). Carried back so the accept step can reference
  // it in the new version's edit note.
  reasoningTraceId: string
  modelIdentity: string
  instruction: string
}

// reviseDraftText — SYNCHRONOUS AI revision (the WP-C flagship). Reads the base
// version, asks Claude to redraft the WHOLE document under the attorney's
// instruction, records a reasoning trace, and returns the revised markdown for a
// tracked-changes review. It deliberately does NOT create a version: a revision
// the attorney discards should leave no substrate version behind. When accepted,
// the caller persists version n+1 through the existing append-only draft.edit.
export async function reviseDraftText(
  ctx: ActionContext,
  input: ReviseDraftInput,
): Promise<ReviseDraftResult> {
  const instruction = input.instruction.trim()
  if (!instruction) throw new Error('A revision instruction is required.')

  // The stored version is still loaded first — it authenticates the id under the
  // tenant and supplies the document kind — even when a working-text override is
  // supplied.
  const base = await getDraftVersion(ctx, input.documentVersionId)
  if (!base) throw new Error(`Draft version not found: ${input.documentVersionId}`)
  const currentMarkdown = input.baseMarkdown?.trim() ? input.baseMarkdown : base.bodyMarkdown
  if (!currentMarkdown.trim()) throw new Error('The document to revise is empty.')

  // WP A2 — the matter's own resolved jurisdiction (matter fact, else the
  // firm's home jurisdiction, else honest unset). NEVER a hardcoded 'NC'.
  const jurisdiction = await resolveMatterJurisdiction(ctx, base.matterEntityId)

  const prompt = buildRevisionPrompt({
    currentMarkdown,
    documentKind: base.documentKind,
    instruction,
    jurisdictionDisplayName: jurisdiction?.displayName ?? null,
  })

  const result = await callClaudeDrafter(ctx.tenantId, { prompt, task: 'draft_revise' })
  if (!result.documentMarkdown.trim()) {
    throw new Error('The revision came back empty. Try rephrasing the instruction.')
  }

  const reasoningTraceId = await persistRevisionTrace(ctx, {
    prompt,
    evidence: result.reasoningTrace.evidence,
    alternatives: result.reasoningTrace.alternatives_considered,
    conclusion: result.reasoningTrace.conclusion,
    confidence: result.reasoningTrace.confidence,
    modelIdentity: result.modelIdentity,
    fullTrace: { ...result.reasoningTrace, revision_instruction: instruction },
  })

  return {
    revisedMarkdown: result.documentMarkdown,
    reasoningTraceId,
    modelIdentity: result.modelIdentity,
    instruction,
  }
}

interface RevisionPromptArgs {
  currentMarkdown: string
  documentKind: string
  instruction: string
  // WP A2 — the matter's resolved jurisdiction display name, or null when
  // NEITHER the matter nor the firm has one on file. null must NOT fall back
  // to a guessed jurisdiction — the prompt tells the model to say so instead.
  jurisdictionDisplayName?: string | null
}

// The model returns the FULL revised document first, then a fenced ```json trace
// — the same two-part contract callClaudeDrafter (splitDocumentAndTrace) parses.
export function buildRevisionPrompt(args: RevisionPromptArgs): string {
  const kindLabel = args.documentKind.replace(/_/g, ' ')
  const governingLawLine = args.jurisdictionDisplayName
    ? `under ${args.jurisdictionDisplayName} law.`
    : 'the governing jurisdiction is NOT SET — do not assume one; open with a bolded "Governing law to be confirmed" note and avoid state-specific provisions.'
  return `You are a legal drafting assistant revising an existing ${kindLabel} at the reviewing attorney's request, ${governingLawLine}

Output the COMPLETE revised document as clean markdown — not a diff, not a summary, the whole document. The attorney will review your changes as tracked redlines (deletions and insertions) against the current version, then accept or reject them. Make ONLY the changes the instruction calls for: preserve the document's structure, headings, parties, defined terms, and every passage the instruction does not touch, so the redline stays tight and legible.

--- CURRENT DOCUMENT (the version to revise) ---
${args.currentMarkdown}
--- END CURRENT DOCUMENT ---

--- ATTORNEY'S REVISION INSTRUCTION ---
${args.instruction}
--- END INSTRUCTION ---

Return the full revised document markdown FIRST. Then, on a new line, a fenced JSON block:
\`\`\`json
{"evidence":[{"source":"instruction","value":"<what you changed and why>"}],"alternatives_considered":[],"conclusion":"<one-line summary of the revision>","confidence":0.0,"ambiguities":[]}
\`\`\`
Give an honest confidence in [0,1) — never 1.0.`
}

interface PersistRevisionTraceArgs {
  prompt: string
  evidence: unknown[]
  alternatives: unknown[]
  conclusion: string
  confidence: number
  modelIdentity: string
  fullTrace: unknown
}

// Mirrors generateDraft.ts persistReasoningTrace (a local helper, not an
// importable export): an append-only INSERT into reasoning_trace inside its own
// action-context transaction. exsto-ai-operation: every AI operation records a
// trace with honest, clamped confidence.
async function persistRevisionTrace(
  ctx: ActionContext,
  args: PersistRevisionTraceArgs,
): Promise<string> {
  const id = randomUUID()
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        id,
        ctx.tenantId,
        CLAUDE_AGENT_ACTOR_ID,
        args.prompt,
        JSON.stringify(args.evidence ?? []),
        JSON.stringify(args.alternatives ?? []),
        args.conclusion ?? 'AI revision of an existing draft.',
        clampConfidence(args.confidence),
        args.modelIdentity,
        JSON.stringify(args.fullTrace),
      ],
    )
  })
  return id
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(0.99, Math.max(0, n))
}
