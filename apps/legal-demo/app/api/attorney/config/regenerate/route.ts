import { NextResponse } from 'next/server'
import {
  enqueueConfigRegenerate,
  getConfigRegenerateResult,
  getLatestConfigProposalForTarget,
  type ConfigArtifactKind,
} from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// UI-BUILDER-FIX-1 Phase 9 — the edit modal's AI-regenerate rail. POST enqueues
// a legal.config.regenerate worker_job (generation NEVER rides the request) and
// returns the request id; GET polls the outcome event. Thin adapter over the
// operation core; the tenant comes from the signed session, never the body.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    artifactKind?: ConfigArtifactKind
    targetId?: string
    prompt?: string
    current?: string
  } | null
  if (!body?.artifactKind || !body?.targetId || !body?.prompt) {
    return NextResponse.json(
      { error: 'artifactKind, targetId and prompt are required.' },
      { status: 400 },
    )
  }
  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }
  try {
    const r = await enqueueConfigRegenerate(ctxOrError, {
      artifactKind: body.artifactKind,
      targetId: body.targetId,
      prompt: body.prompt,
      current: body.current ?? '',
    })
    return NextResponse.json(r)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestId = url.searchParams.get('requestId') ?? ''
  // Phase 10: ?artifactKind&targetId fetches the latest PENDING proposal for a
  // target (e.g. the questionnaire rebuild a template edit enqueued) so the
  // modal surfaces it on open.
  const artifactKind = url.searchParams.get('artifactKind') as ConfigArtifactKind | null
  const targetId = url.searchParams.get('targetId') ?? ''
  if (!requestId && !(artifactKind && targetId)) {
    return NextResponse.json(
      { error: 'requestId, or artifactKind + targetId, is required.' },
      { status: 400 },
    )
  }
  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }
  const result = requestId
    ? await getConfigRegenerateResult(ctxOrError, requestId)
    : await getLatestConfigProposalForTarget(ctxOrError, artifactKind!, targetId)
  return NextResponse.json({ result })
}
