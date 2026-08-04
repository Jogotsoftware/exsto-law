// ASSISTANT-ACTS-1 — stage an e-sign envelope from chat. "Send the engagement
// letter for signature" resolves the matter document server-side (by the
// attorney's words, never an id the model could hallucinate) and the chat opens
// the firm's unified eSign composer (EsignComposer, document mode) in a pop-up.
// CHATBOT-CATCHUP-1 adds the DESIGN §8 blank mode: "e-sign a PDF for me" with
// no matter (or an uploaded/external PDF) opens the SAME composer blank, where
// the attorney uploads the file — closing the long-standing chat dead-end.
// The ATTORNEY confirms signers/fields and clicks Send there — this tool writes
// nothing and sends nothing, mirroring the open_artifact_editor launch pattern.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { listMatterDraftVersions } from '../queries/drafts.js'

// Everything the client needs to open the composer without another round-trip.
// mode 'document' carries a resolved matter document version; mode 'blank'
// opens the upload composer (no document resolved — the attorney attaches the
// PDF in the composer itself). status rides along so the modal can note a
// not-yet-approved version (the manual send path allows any status; the
// attorney is the gate).
export type EnvelopePrepareLaunch =
  | {
      mode: 'document'
      documentVersionId: string
      documentKind: string
      versionNumber: number
      status: string
    }
  | { mode: 'blank' }

const PREPARE_ENVELOPE_TOOL_DEF = {
  name: 'prepare_envelope',
  description:
    "Open the firm's ONE unified send-for-signature composer when the attorney asks to get something signed / e-signed / sent for signature. TWO MODES. mode 'matter_document' (needs the current matter): pass what the attorney called the document (its kind or title words) as document_hint — the platform resolves it to the matter's actual document; never pass or invent an id; if more than one matches, the result lists them: ask the attorney WHICH one, then call again. mode 'upload': for a PDF that is NOT a matter document — an uploaded file, an external document, or any signing request outside a matter — the composer opens BLANK and the attorney attaches the PDF there; use this whenever there is no matter in scope or they name a file rather than a matter document. Either way the composer opens for the ATTORNEY to confirm signers, place signature fields, and click Send — this tool sends nothing, so never claim an envelope was sent. A document you produced in chat this turn must be saved to the matter first (the attorney does that from its card). Your reply after this call must be ONE short sentence pointing them to the composer. (Note for guidance questions: signature FIELD placement for a service's documents is authored on the TEMPLATE — Templates tab → Signers; at run time the workflow's e-sign step opens this same composer pre-wired. This ad-hoc composer is for one-off sends.)",
  input_schema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['matter_document', 'upload'],
        description:
          "'matter_document' resolves document_hint against the current matter's documents (requires a matter in scope). 'upload' opens the blank composer for the attorney to attach any PDF — the only valid mode when no matter is in scope.",
      },
      document_hint: {
        type: 'string',
        description:
          "REQUIRED for mode 'matter_document': the document as the attorney referred to it — kind or title words (e.g. 'engagement letter', 'operating agreement'). Matched case-insensitively against the matter's documents. Ignored for mode 'upload'.",
      },
    },
    required: ['mode'],
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

// Build the prepare_envelope ClientTool for this turn. matterEntityId is null on
// an unscoped chat — mode 'upload' still works there (that's the point); mode
// 'matter_document' comes back with an honest redirect. run() resolves the
// hint against the matter's latest draft versions (any status — the composer
// shows it) and captures a launch descriptor; ambiguity comes back as an
// instructive result, never a guess.
export function buildPrepareEnvelopeTool(
  ctx: ActionContext,
  matterEntityId: string | null,
  captured: EnvelopePrepareLaunch[],
): ClientTool {
  return {
    definition: PREPARE_ENVELOPE_TOOL_DEF,
    name: 'prepare_envelope',
    run: async (raw) => {
      const args = (raw ?? {}) as { mode?: string; document_hint?: string }
      const mode = (args.mode ?? '').trim()
      if (mode === 'upload') {
        captured.push({ mode: 'blank' })
        return 'The e-sign composer is open, blank, for the attorney to attach their PDF, add signers, place fields and click Send. Reply with ONE short sentence pointing them to it; do NOT claim anything was sent.'
      }
      if (mode !== 'matter_document') {
        return `mode must be 'matter_document' or 'upload'; nothing was opened.`
      }
      if (!matterEntityId) {
        return "There is no matter in scope on this chat, so a matter document cannot be resolved. If the attorney wants to e-sign a PDF they have (not a matter document), call again with mode 'upload'; otherwise ask them to open the matter first."
      }
      const hint = (args.document_hint ?? '').trim()
      if (!hint) return "document_hint is required for mode 'matter_document'; nothing was opened."
      const versions = await listMatterDraftVersions(ctx, matterEntityId)
      if (!versions.length) {
        return "This matter has no documents yet — a document must exist (e.g. drafted and saved to the matter) before it can be sent for signature. For a PDF the attorney has on hand, call again with mode 'upload'."
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
        mode: 'document',
        documentVersionId: v.documentVersionId,
        documentKind: v.documentKind,
        versionNumber: v.versionNumber,
        status: v.status,
      })
      return `The send-for-signature composer is open for the attorney on the ${readable(v.documentKind)} (v${v.versionNumber}). They confirm signers and fields and click Send there. Reply with ONE short sentence pointing them to it; do NOT claim the envelope was sent.`
    },
  }
}
