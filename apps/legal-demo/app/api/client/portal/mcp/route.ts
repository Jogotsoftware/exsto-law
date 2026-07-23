import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect),
// and import the AUTHED client-portal allowlist that gates this route.
import '@exsto/legal/mcp'
import { isClientPortalAuthedTool } from '@exsto/legal/mcp'
import { isClientContactActive, type RecordSignatureResult } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { clientIpFrom } from '@/lib/rateLimit'
import { finalizeEnvelopeIfCompleted } from '@/lib/esignStamping'
import { generateAndStoreEngagementExecutedCopy } from '@/lib/engagementExecutedCopy'

export const runtime = 'nodejs'
// RUNTIME-AUTORUN-2: a client delivery here (an upload/message that advances a gate) may
// land the matter on a producing stage (generate_document), whose autorun drafts
// synchronously in this request. Allow the model budget so it does not time out.
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ClientCtx {
  ctx: ActionContext
  clientContactId: string
  matterIds: string[]
}

// Authority for "who is this client" is the SIGNED, httpOnly exsto_client_session
// cookie, verified server-side and DERIVED FROM ONLY (never from the body or any
// header). Mirrors the attorney route's resolveCtx:
//   • verify the cookie → identity
//   • shape-check the ids
//   • re-check the client_contact is STILL active in the live DB (a deactivated
//     contact can't keep acting on an unexpired cookie)
//   • production: no valid cookie ⇒ 401, full stop (no dev header fallback —
//     this is a real client-facing auth surface).
async function resolveClientCtx(
  request: Request,
): Promise<ClientCtx | { error: string; status: number }> {
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return { error: 'Not signed in. Request a sign-in link to continue.', status: 401 }
  }
  const { clientContactId, tenantId, matterIds, clientActorId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId) || !UUID_RE.test(clientActorId)) {
    return { error: 'Invalid session.', status: 401 }
  }
  if (!Array.isArray(matterIds) || !matterIds.every((m) => UUID_RE.test(m))) {
    return { error: 'Invalid session.', status: 401 }
  }
  // Live re-check: the contact must still be an active entity in its tenant.
  const active = await isClientContactActive(tenantId, clientContactId)
  if (!active) return { error: 'Session no longer valid.', status: 401 }

  // PORTAL-1: every authed portal read/write runs AS THE CLIENT'S OWN ACTOR
  // (minted into the session at sign-in) — intake, bookings, payments, consents
  // and messages are attributed to the person, not the shared public-intake
  // system actor. The clientContactId is still stamped into tool input below.
  return {
    ctx: { tenantId, actorId: clientActorId },
    clientContactId,
    matterIds,
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }

  // Default-deny against the AUTHED allowlist. A non-allowlisted name gets the
  // SAME 404 as an unknown tool — no oracle for which attorney-only tools exist.
  const tool = isClientPortalAuthedTool(body.toolName) ? findTool(body.toolName) : undefined
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }

  const resolved = await resolveClientCtx(request)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { ctx, clientContactId, matterIds } = resolved

  // Stamp identity from the COOKIE, overwriting anything the body sent. The body
  // is never trusted to assert who the client is or which matters they own.
  const input: Record<string, unknown> = { ...(body.input ?? {}) }
  input.clientContactId = clientContactId
  // Requester IP for audit trails (e-sign open/sign) — from the request, never
  // the body.
  input.clientIp = clientIpFrom(request)

  // PER-MATTER AUTHORIZATION (critical): any tool input naming a matterEntityId
  // must reference a matter THIS client is client_of. A miss returns the SAME
  // 404 as an unknown tool — never 403/empty — so the response is no oracle for
  // "this matter exists but isn't yours" vs "no such matter". Checked BEFORE
  // dispatch, against the cookie's matterIds (re-resolved at consume time).
  if (typeof input.matterEntityId === 'string') {
    if (!matterIds.includes(input.matterEntityId)) {
      return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
    }
  }

  try {
    const result = await tool.handler(ctx, input)
    // esign-executed-copy-complete — the token sign route
    // (/api/sign/submit) has always stamped the executed PDF on completion;
    // this portal route (legal.esign.portal.sign, dispatched generically
    // above) never did, so a portal-completed envelope never got its
    // `.executed.pdf` and every byte route that "prefers the executed copy"
    // silently fell back to the unsigned original. Run the SAME stamping
    // step here (apps/legal-demo/lib/esignStamping.ts's
    // finalizeEnvelopeIfCompleted — the app layer owns Storage bytes; the
    // vertical never touches Storage, CI storage-guard), then email everyone
    // the executed document. ESIGN-ATTORNEY-REVIEW-1: the SAME helper now
    // also backs the attorney MCP route's legal.esign.sign_submit, so this
    // stays the one completion step for every route that can finish an
    // envelope. Best-effort: the signature is already recorded, so a
    // stamping/notify failure must never turn a successful signing into an
    // error.
    // ADD-NEXT-SIGNER-1 — .finish can ALSO complete an envelope (the deferred
    // completion a signer's "no more signers" confirms) — same stamping step.
    if (
      body.toolName === 'legal.esign.portal.sign' ||
      body.toolName === 'legal.esign.portal.finish'
    ) {
      await finalizeEnvelopeIfCompleted(ctx, result as RecordSignatureResult)
    }

    // ENGAGEMENT-DOC-1 — when the client accepts the firm's engagement agreement,
    // their typed name is a signature: render + stamp + store the executed copy
    // (downloadable afterward). Same app-layer-owns-Storage split as e-sign above.
    // Best-effort: the acceptance is already recorded, so a render/store failure
    // must never turn a successful acceptance into an error.
    if (body.toolName === 'legal.client.engagement_accept') {
      const signerName = typeof input.signedName === 'string' ? input.signedName.trim() : ''
      if (signerName) {
        await generateAndStoreEngagementExecutedCopy(ctx, clientContactId, {
          signerName,
          signedAtIso: new Date().toISOString(),
        }).catch((copyErr) => {
          console.error('engagement executed-copy failed:', copyErr)
        })
      }
    }
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
