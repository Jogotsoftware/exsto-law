import { NextResponse } from 'next/server'
import { createTemplateAI } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// Template-proposal APPROVE route (Build-Wizard Phase 3) — THE HUMAN GATE. The chat
// turn that proposes a document template writes NOTHING: it only captures the
// proposal as an inline card (with its orphan tokens). The live write happens ONLY
// here, when the attorney clicks Approve. This is a THIN adapter over the operation
// core: it resolves the tenant from the signed session (never the request body), then
// delegates to createTemplateAI — which persists a reasoning_trace and submits the
// service-bound document_templates write AS THE CLAUDE AGENT ACTOR (intent
// 'exploration', trace attached). It never touches the substrate directly. The
// serviceKey comes from the route, not the body, so the approval binds the template
// to the service the attorney is looking at.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceKey: string }> },
) {
  const { serviceKey } = await params
  if (!serviceKey) {
    return NextResponse.json({ error: 'serviceKey is required' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string
    body?: string
    docKind?: string
    summary?: string
    confidence?: number
    // BUILDER-CERT-1 (WP3) — the card's signability declaration; validated by the
    // template handler's normalizeSignature on write.
    signature?: { required: boolean; signer_roles: string[] }
  } | null
  const docBody = (body?.body ?? '').trim()
  const docKind = (body?.docKind ?? '').trim()
  if (!docBody || !docKind) {
    return NextResponse.json(
      { error: 'A template body and a document kind are required.' },
      { status: 400 },
    )
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await createTemplateAI(
      ctxOrError,
      serviceKey,
      {
        name: (body?.name ?? '').trim() || docKind,
        body: docBody,
        docKind,
        category: 'document',
        ...(body?.signature
          ? {
              signature: {
                required: body.signature.required === true,
                signer_roles: (body.signature.signer_roles ?? []).filter(
                  (r): r is 'client' | 'attorney' | 'witness' | 'notary' =>
                    r === 'client' || r === 'attorney' || r === 'witness' || r === 'notary',
                ),
              },
            }
          : {}),
      },
      {
        conclusion:
          (body?.summary ?? '').trim() || `Authored a "${docKind}" template for ${serviceKey}.`,
        confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      },
    )
    // Return the LINK to the service's templates page + serviceKey + label so the chat
    // can show "View templates →" and auto-continue the guided build (Phase 6).
    return NextResponse.json({
      result,
      serviceKey,
      link: `/attorney/services/${encodeURIComponent(serviceKey)}/templates`,
      label: `Template "${(body?.name ?? '').trim() || docKind}"`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
