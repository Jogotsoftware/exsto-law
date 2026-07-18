// ASSISTANT-ACTS-1 — stage an e-sign envelope from chat. "Send the engagement
// letter for signature" resolves the matter document server-side (by the
// attorney's words, never an id the model could hallucinate) and the chat opens
// the firm's real 4-step prepare wizard (PrepareSignature) in a pop-up. The
// ATTORNEY confirms signers/fields and clicks Send there — this tool writes
// nothing and sends nothing, mirroring the open_artifact_editor launch pattern.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { listMatterDraftVersions } from '../queries/drafts.js'

// Everything the client needs to open the prepare-signature modal without
// another round-trip. status rides along so the modal can note a not-yet-
// approved version (the manual send path allows any status; the attorney is
// the gate).
export interface EnvelopePrepareLaunch {
  documentVersionId: string
  documentKind: string
  versionNumber: number
  status: string
}

const PREPARE_ENVELOPE_TOOL_DEF = {
  name: 'prepare_envelope',
  description:
    "Open the firm's REAL send-for-signature wizard on one of THIS matter's documents when the attorney asks to get something signed / e-signed / sent for signature. Pass what the attorney called the document (its kind or title words) — the platform resolves it to the matter's actual document; never pass or invent an id. If more than one document matches, the result lists them: ask the attorney WHICH one, then call again. The wizard opens for the ATTORNEY to confirm signers, place signature fields, and click Send — this tool sends nothing, so never claim an envelope was sent. A document you produced in chat this turn must be saved to the matter first (the attorney does that from its card). Your reply after this call must be ONE short sentence pointing them to the wizard.",
  input_schema: {
    type: 'object',
    properties: {
      document_hint: {
        type: 'string',
        description:
          "The document as the attorney referred to it — kind or title words (e.g. 'engagement letter', 'operating agreement'). Matched case-insensitively against the matter's documents.",
      },
    },
    required: ['document_hint'],
    additionalProperties: false,
  },
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matches(candidate: string, query: string): boolean {
  const c = normalize(candidate)
  const q = normalize(query)
  if (!c || !q) return false
  return c === q || c.includes(q) || q.includes(c)
}

// Build the prepare_envelope ClientTool for this turn. run() resolves the
// hint against the matter's latest draft versions (any status — the wizard
// shows it) and captures a launch descriptor; ambiguity comes back as an
// instructive result, never a guess.
export function buildPrepareEnvelopeTool(
  ctx: ActionContext,
  matterEntityId: string,
  captured: EnvelopePrepareLaunch[],
): ClientTool {
  return {
    definition: PREPARE_ENVELOPE_TOOL_DEF,
    name: 'prepare_envelope',
    run: async (raw) => {
      const args = (raw ?? {}) as { document_hint?: string }
      const hint = (args.document_hint ?? '').trim()
      if (!hint) return 'document_hint is required; nothing was opened.'
      const versions = await listMatterDraftVersions(ctx, matterEntityId)
      if (!versions.length) {
        return 'This matter has no documents yet — a document must exist (e.g. drafted and saved to the matter) before it can be sent for signature.'
      }
      const readable = (kind: string): string => kind.replace(/_/g, ' ')
      const hits = versions.filter((v) => matches(readable(v.documentKind), hint))
      if (hits.length === 0) {
        return `No matter document matched "${hint}". The matter's documents: ${versions.map((v) => readable(v.documentKind)).join('; ')}. Ask the attorney which one they mean.`
      }
      if (hits.length > 1) {
        return `More than one document matches "${hint}": ${hits.map((v) => readable(v.documentKind)).join('; ')}. Ask the attorney WHICH one, then call again.`
      }
      const v = hits[0]!
      captured.push({
        documentVersionId: v.documentVersionId,
        documentKind: v.documentKind,
        versionNumber: v.versionNumber,
        status: v.status,
      })
      return `The send-for-signature wizard is open for the attorney on the ${readable(v.documentKind)} (v${v.versionNumber}). They confirm signers and fields and click Send there. Reply with ONE short sentence pointing them to it; do NOT claim the envelope was sent.`
    },
  }
}
