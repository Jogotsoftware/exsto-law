import { NextResponse } from 'next/server'
import { defineKind } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// New data-kind proposal APPROVE route (Build-Wizard, Tier 1 data-as-schema) —
// THE HUMAN GATE. The chat turn that proposes a new kind writes NOTHING; it only
// captures the proposal as an inline card. The kind is minted (kind.define) ONLY
// here, on approve. Thin adapter over the operation core: resolves the tenant from
// the signed session (never the request body), then delegates to defineKind, which
// re-validates and submits kind.define through the action layer.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    registry?: string
    kindName?: string
    displayName?: string
    description?: string | null
    onEntityKind?: string | null
    valueType?: string | null
    sourceEntityKind?: string | null
    targetEntityKind?: string | null
  } | null
  const registry = (body?.registry ?? '').trim()
  const kindName = (body?.kindName ?? '').trim()
  const displayName = (body?.displayName ?? '').trim()
  if (!registry || !kindName || !displayName) {
    return NextResponse.json(
      { error: 'registry, kindName and displayName are required.' },
      { status: 400 },
    )
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await defineKind(ctxOrError, {
      registry,
      kindName,
      displayName,
      description: body?.description ?? null,
      onEntityKind: body?.onEntityKind ?? null,
      valueType: body?.valueType ?? null,
      sourceEntityKind: body?.sourceEntityKind ?? null,
      targetEntityKind: body?.targetEntityKind ?? null,
    })
    return NextResponse.json({
      result,
      // No dedicated page for a kind — link the attorney to the service editor so
      // the continuation reads naturally ("defined X — continuing the build").
      link: '/attorney/services',
      label: `${registry} kind "${result.kindName}"`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
