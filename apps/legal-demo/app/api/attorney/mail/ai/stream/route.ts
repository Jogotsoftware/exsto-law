import { streamComposeEmail, type ComposeEmailStreamInput } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// SSE sibling of the templates/ai/stream route, for the compose modal's
// "Draft with AI": streams a concrete client email (SUBJECT: first line, then
// body) so the gateway never times out and the attorney sees progress. Thin
// adapter over the same operation core — tenant + actor resolved from the
// signed session (never from the request body), delegates to
// streamComposeEmail (pure generation — no substrate write), never touches
// the DB.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<ComposeEmailStreamInput> | null
  if (!body || typeof body.instructions !== 'string' || !body.instructions.trim()) {
    return Response.json({ error: 'instructions is required' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return Response.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }
  const ctx = ctxOrError

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        for await (const chunk of streamComposeEmail(ctx, {
          instructions: body.instructions as string,
          matterEntityId: typeof body.matterEntityId === 'string' ? body.matterEntityId : undefined,
          clientEntityId: typeof body.clientEntityId === 'string' ? body.clientEntityId : undefined,
        })) {
          send(chunk)
        }
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
