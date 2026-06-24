import { streamTemplateAi, type TemplateAiStreamInput } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// Streaming sibling of the legal.template.ai_draft / ai_enhance MCP tools. A full
// document (an Operating Agreement, say) takes far longer to generate than a
// serverless gateway will hold a synchronous request — so the Templates editor's
// "Draft / Enhance with AI" streams the body over SSE instead, which both defeats
// the gateway timeout (504) and shows the attorney progress. Thin adapter over the
// same operation core: resolves the tenant from the signed session, delegates to
// streamTemplateAi (pure generation — no substrate write), never touches the DB.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<TemplateAiStreamInput> | null
  if (!body || (body.mode !== 'draft' && body.mode !== 'enhance')) {
    return Response.json({ error: "mode must be 'draft' or 'enhance'" }, { status: 400 })
  }
  if (body.category !== 'document' && body.category !== 'email') {
    return Response.json({ error: "category must be 'document' or 'email'" }, { status: 400 })
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
        for await (const chunk of streamTemplateAi(ctx, body as TemplateAiStreamInput)) {
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
