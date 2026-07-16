import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { approveDocument } from '@exsto/legal'
import '@exsto/legal' // register action handlers (side effect)

// Contract W (BACKHALF-BLOCKS-1 WP1) — APPROVE a document version, optionally
// sending the client the draft link in the same call. Approval flows through
// draft.approve, which accrues the document's fee (document_fee.recorded — the
// modal's promise, now real) and advances the workflow. Idempotent: a second
// approve adds no second fee. RLS scopes the version to the caller's tenant.
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = (await request.json().catch(() => null)) as { send?: boolean } | null
  const send = body?.send === true

  try {
    const result = await approveDocument(ctx, { documentVersionId: versionId, send })
    return NextResponse.json({ approved: result.approved, sent: result.sent })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to approve the document.'
    const status = /not found/i.test(message) ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
