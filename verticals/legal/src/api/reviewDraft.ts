import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { getDraftVersion } from '../queries/drafts.js'
import { sendDraftLinkEmail, sendCommunicationDraft } from './email.js'
import { longDate } from './templateMerge.js'
import { isSystemToken } from './tokenClasses.js'
import { getTenantSettingsForMerge } from './tenantSettings.js'

export interface DraftReviewInput {
  documentVersionId: string
  reviewNotes?: string
}

// Public base for the client-facing draft link (`/d/<versionId>`), server side —
// mirrors clientRequests.ts. The browser builds the same URL via shareUrlFor().
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

// ─── P13: approve-time SYSTEM-token resolution ──────────────────────────────
// The tokens the approve step itself can resolve, and their DETERMINISTIC
// sources (no model call in the approve flow — the #303 lesson):
//   attorney_name / attorney_email → the approving actor row (display_name /
//     external_id), only when the approver is a human actor;
//   letter_date / today            → the approval date (merge's longDate format);
//   firm_name/address/phone/email  → the firm_profile singleton, falling back to
//     the legacy tenant_settings table — NEVER FIRM_DEFAULTS (the ForMerge read
//     keeps the anti-forgery guard: unknown stays MISSING).
// effective_date is deliberately NOT touched — it is a legal fact, not a stamp.
// Any token with no honest value stays as-is ([[MISSING]] visible).

// Matches an unresolved token in either form the pipeline produces: the raw
// {{token}} (ai_draft path) or the merge engine's [[MISSING: token]] marker.
function unresolvedTokenRe(token: string): RegExp {
  return new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}|\\[\\[MISSING:\\s*${token}\\s*\\]\\]`, 'gi')
}

// Any unresolved SYSTEM-class token left in the body? (Cheap pre-check before
// building the resolution map.)
function hasUnresolvedSystemToken(body: string): boolean {
  const forms = [/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, /\[\[MISSING:\s*([a-zA-Z0-9_.]+)\s*\]\]/g]
  for (const re of forms) {
    for (const m of body.matchAll(re)) {
      if (m[1] && isSystemToken(m[1])) return true
    }
  }
  return false
}

// The approving attorney's identity — a deterministic read of their actor row
// (the api/users.ts external_id-as-email pattern). Agent/system actors never
// stamp attorney identity.
async function readApprovingAttorney(
  ctx: ActionContext,
): Promise<{ name: string | null; email: string | null }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      display_name: string | null
      external_id: string | null
      actor_type: string
    }>(`SELECT display_name, external_id, actor_type FROM actor WHERE tenant_id = $1 AND id = $2`, [
      ctx.tenantId,
      ctx.actorId,
    ])
    const row = res.rows[0]
    if (!row || row.actor_type !== 'human') return { name: null, email: null }
    return { name: row.display_name?.trim() || null, email: row.external_id?.trim() || null }
  })
}

// Resolve the system tokens still unresolved in the version body. If anything
// resolves, persist the result as version n+1 via the EXISTING append-only
// document.edit action and return the NEW version id — the caller approves THAT
// version, so every 'latest approved' consumer (e-sign, /d share, portal, mail)
// can only ever see the resolved body. Returns the input id when there is
// nothing to resolve.
async function resolveSystemTokensBeforeApprove(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<string> {
  const draft = await getDraftVersion(ctx, documentVersionId)
  // Unknown version: fall through and let draft.approve surface the error.
  if (!draft) return documentVersionId
  const body = draft.bodyMarkdown ?? ''
  if (!hasUnresolvedSystemToken(body)) return documentVersionId

  const attorney = await readApprovingAttorney(ctx)
  const firm = await getTenantSettingsForMerge(ctx)
  const approvalDate = longDate(new Date().toISOString())
  const values: Record<string, string | null> = {
    attorney_name: attorney.name,
    attorney_email: attorney.email,
    letter_date: approvalDate,
    today: approvalDate,
    firm_name: firm.firmName,
    firm_address: firm.firmAddress,
    firm_phone: firm.firmPhone,
    firm_email: firm.firmEmail,
  }

  let resolvedBody = body
  const resolved: string[] = []
  for (const [token, value] of Object.entries(values)) {
    if (!value?.trim()) continue // no honest value → the token stays visible
    const next = resolvedBody.replace(unresolvedTokenRe(token), value)
    if (next !== resolvedBody) {
      resolvedBody = next
      resolved.push(token)
    }
  }
  if (resolved.length === 0) return documentVersionId

  const edit = await submitAction(ctx, {
    actionKindName: 'document.edit',
    intentKind: 'correction',
    payload: {
      document_version_id: documentVersionId,
      document_markdown: resolvedBody,
      note: `Resolved at approval: ${resolved.join(', ')}`,
    },
  })
  const effects = (edit.effects[0] ?? {}) as { documentVersionId?: string }
  return effects.documentVersionId ?? documentVersionId
}

export async function approveDraft(
  ctx: ActionContext,
  input: DraftReviewInput,
): Promise<ActionResult> {
  // P13: resolve remaining system tokens FIRST (append-only version n+1), then
  // approve the RESOLVED version — in sequence within this same request, so the
  // unresolved body never becomes an approved version.
  const finalVersionId = await resolveSystemTokensBeforeApprove(ctx, input.documentVersionId)
  const res = await submitAction(ctx, {
    actionKindName: 'draft.approve',
    intentKind: 'enforcement',
    payload: {
      document_version_id: finalVersionId,
      review_notes: input.reviewNotes,
    },
  })
  // MACHINE-COMMS-1 (WP2): for a COMMUNICATION draft, approve = send. EVERY approve
  // path (queue batch, editor, MCP tool) funnels through here, so the law holds
  // everywhere. The send runs after the approve committed (same posture as
  // approveDocument's draft-link send): a send failure does not roll the approval
  // back — it surfaces loudly, and re-approving retries the send (reviewDecision
  // re-approves idempotently).
  const effects = (res.effects[0] ?? {}) as { isCommunication?: boolean }
  if (effects.isCommunication === true) {
    try {
      await sendCommunicationDraft(ctx, finalVersionId)
    } catch (err) {
      throw new Error(
        `The email draft is APPROVED, but sending failed: ${
          err instanceof Error ? err.message : String(err)
        } Approve it again to retry the send.`,
      )
    }
  }
  return res
}

export interface ApproveDocumentResult {
  approved: boolean
  sent: boolean
}

// Contract W — approve a document version and (optionally) send the client the draft
// link in ONE call. Approval flows through draft.approve (which accrues the document
// fee — WP1 — and advances the workflow). When `send` is set, the client gets the
// Pacheco Law email with the public `/d/<versionId>` link, recorded through the
// existing mail path. `send` failures do NOT roll back the approval (the fee/advance
// already committed); they surface so the caller can retry the send alone.
export async function approveDocument(
  ctx: ActionContext,
  input: { documentVersionId: string; send: boolean; reviewNotes?: string },
): Promise<ApproveDocumentResult> {
  if (!input.documentVersionId?.trim()) throw new Error('documentVersionId is required.')
  const res = await approveDraft(ctx, {
    documentVersionId: input.documentVersionId,
    reviewNotes: input.reviewNotes,
  })
  // P13: approve-time token resolution may have approved a NEW version (n+1 with
  // the system tokens filled). Everything downstream — the share link, the send —
  // must reference the version that was actually approved, never the stale input.
  const approveEffects = (res.effects[0] ?? {}) as { documentVersionId?: string }
  const approvedVersionId = approveEffects.documentVersionId ?? input.documentVersionId
  const draft = await getDraftVersion(ctx, approvedVersionId)
  // A communication draft was ALREADY sent by approveDraft (approve = send);
  // never follow with a /d draft-link email — there is no client-facing document.
  if (draft?.channel === 'communication') return { approved: true, sent: true }
  if (!input.send) return { approved: true, sent: false }

  if (!draft) throw new Error(`Approved, but draft version not found to send: ${approvedVersionId}`)
  await sendDraftLinkEmail(ctx, {
    matterEntityId: draft.matterEntityId,
    documentVersionId: approvedVersionId,
    shareUrl: `${BASE_URL}/d/${approvedVersionId}`,
  })
  return { approved: true, sent: true }
}

export async function requestDraftRevision(
  ctx: ActionContext,
  input: DraftReviewInput,
): Promise<ActionResult> {
  if (!input.reviewNotes) {
    throw new Error('Review notes are required to request a revision.')
  }
  return submitAction(ctx, {
    actionKindName: 'draft.request_revision',
    intentKind: 'correction',
    payload: {
      document_version_id: input.documentVersionId,
      review_notes: input.reviewNotes,
    },
  })
}

export async function rejectDraft(
  ctx: ActionContext,
  input: DraftReviewInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'draft.reject',
    intentKind: 'enforcement',
    payload: {
      document_version_id: input.documentVersionId,
      review_notes: input.reviewNotes,
    },
  })
}

export interface DraftEditInput {
  documentVersionId: string
  documentMarkdown: string
  // Optional one-liner describing the change; stored on the new version's metadata.
  note?: string
}

// Attorney inline edit: saves the revised markdown as a NEW document_version
// (the document.edit handler is append-only — invariant 14, never an in-place
// overwrite — and the new version inherits the source's status). Lets a reviewer
// fix a clause or a name directly instead of round-tripping through a full
// regenerate. intent is `correction`: the attorney is correcting the document.
export async function editDraft(ctx: ActionContext, input: DraftEditInput): Promise<ActionResult> {
  if (!input.documentMarkdown.trim()) {
    throw new Error('The document cannot be empty.')
  }
  return submitAction(ctx, {
    actionKindName: 'document.edit',
    intentKind: 'correction',
    payload: {
      document_version_id: input.documentVersionId,
      document_markdown: input.documentMarkdown,
      note: input.note?.trim() || undefined,
    },
  })
}
