import {
  assistantChatStream,
  type AssistantChatInput,
  type AssistantChatStreamEvent,
} from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'
// A guided service build (interview + drafting whole documents) can run well past the
// default function timeout, so raise the ceiling. The build also has naturally silent
// windows (the model generating a long tool input), so we also stream a keepalive
// below to stop the connection idling out.
export const maxDuration = 300

// Server-Sent-Events sibling of the MCP `legal.assistant.chat` tool: it streams
// the assistant's reply token-by-token for the chat UI. This is a THIN adapter
// over the same operation core — it resolves the tenant from the signed session
// (never the request body), delegates to `assistantChatStream` (which records
// the turn through the action layer), and never touches the substrate directly.
// The MCP route stays the non-streaming path; this exists only because SSE can't
// ride the JSON envelope.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as AssistantChatInput | null
  if (!body || typeof body.message !== 'string' || typeof body.modelId !== 'string') {
    return Response.json({ error: 'message and modelId are required' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return Response.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }
  const ctx = ctxOrError

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantChatStreamEvent | { type: 'error'; message: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      // Keepalive: an SSE comment every 10s so a long, momentarily-silent generation
      // (e.g. the model drafting a whole document) never idles the connection out via a
      // proxy/CDN/function idle timeout. Comments (": …") are ignored by EventSource and
      // by our line parser, so they're invisible to the client. Cleared in finally.
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          /* stream already closing */
        }
      }, 10_000)
      try {
        for await (const event of assistantChatStream(ctx, body)) {
          send(event)
        }
      } catch (err) {
        // A failure mid-stream (bad key, model error) surfaces as an `error`
        // event the client renders, rather than a torn connection.
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        clearInterval(keepalive)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // Defeat proxy/CDN response buffering so tokens arrive as they're produced.
      'x-accel-buffering': 'no',
    },
  })
}
