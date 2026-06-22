import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import {
  resolveMatterAttachments,
  enqueueClientEmail,
  replyToThread,
  type AttachmentRef,
} from '@exsto/legal'
import '@exsto/legal' // register legal action handlers (mail.send) — side effect
import { downloadObject } from '@/lib/documentStorage'

// Send a client email WITH document attachments. Attachments can't ride the JSON
// MCP transport as bytes (and shouldn't — that would let a caller attach arbitrary
// content / bypass scope), so this dedicated route takes attachment REFERENCES
// ({kind:'upload'|'draft', id}) and the server resolves them to bytes under the
// matter-scope rule. Tenancy is identical to the MCP route: ctx comes from the
// SIGNED cookie via resolveAttorneyCtx, never the request body.
//
// The matter-scope guarantees compose from three vertical checks (no app-layer
// authz): resolveMatterAttachments asserts each doc belongs to `matterId` AND the
// sender may send on it; enqueueClientEmail/replyToThread assert the recipient is a
// client of `matterId` AND the sender may send on it. So: doc ∈ matter ∧ recipient
// client_of matter ∧ sender authorized — all enforced in @exsto/legal.
export const runtime = 'nodejs'

interface SendBody {
  mode: 'compose' | 'reply'
  to?: string
  gmailThreadId?: string
  subject?: string
  bodyText: string
  bodyHtml?: string
  matterId: string
  attachments?: AttachmentRef[]
}

export async function POST(request: Request) {
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  let body: SendBody
  try {
    body = (await request.json()) as SendBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!body.matterId || !body.bodyText?.trim()) {
    return NextResponse.json({ error: 'matterId and bodyText are required.' }, { status: 400 })
  }
  const refs = Array.isArray(body.attachments) ? body.attachments : []

  try {
    // Resolve refs → bytes server-side, enforcing each doc belongs to matterId.
    const attachments = await resolveMatterAttachments(ctx, {
      matterEntityId: body.matterId,
      refs,
      downloadUpload: downloadObject,
    })

    if (body.mode === 'reply') {
      if (!body.gmailThreadId) {
        return NextResponse.json({ error: 'gmailThreadId is required for a reply.' }, { status: 400 })
      }
      await replyToThread(ctx, {
        gmailThreadId: body.gmailThreadId,
        bodyText: body.bodyText,
        bodyHtml: body.bodyHtml,
        matterId: body.matterId,
        attachments,
      })
    } else {
      if (!body.to || !body.subject) {
        return NextResponse.json(
          { error: 'to and subject are required to compose.' },
          { status: 400 },
        )
      }
      await enqueueClientEmail(ctx, {
        to: body.to,
        subject: body.subject,
        body: body.bodyText,
        html: body.bodyHtml,
        matterId: body.matterId,
        attachments,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to send.'
    // Authorization failures surface as 403 so the UI can distinguish them.
    const status = /not authorized|not a draft of this matter|not an uploaded document/i.test(msg)
      ? 403
      : 400
    return NextResponse.json({ error: msg }, { status })
  }
}
