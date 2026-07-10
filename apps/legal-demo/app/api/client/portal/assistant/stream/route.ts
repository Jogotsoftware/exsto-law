// PORTAL-1 (WP5) — the client portal chatbot's SSE route. Same brain as the
// attorney assistant (the adapter's chat loop), DIFFERENT HANDS: the tool
// surface inside clientAssistantChatStream is a from-scratch allowlist scoped
// to the session's client. Identity comes from the signed client session
// cookie; the turn runs (and is recorded) as the CLIENT'S OWN actor.
import {
  clientAssistantChatStream,
  isClientContactActive,
  type ClientChatStreamEvent,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`portal-chat:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return Response.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId, clientActorId } = session
  if (
    !UUID_RE.test(clientContactId) ||
    !UUID_RE.test(tenantId) ||
    !UUID_RE.test(clientActorId)
  ) {
    return Response.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return Response.json({ error: 'Session no longer valid.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    message?: unknown
    history?: unknown
  } | null
  if (!body || typeof body.message !== 'string') {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role: 'user' | 'assistant'; content: string }>).filter(
        (h) =>
          h &&
          (h.role === 'user' || h.role === 'assistant') &&
          typeof h.content === 'string',
      )
    : []

  const ctx: ActionContext = { tenantId, actorId: clientActorId }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ClientChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          /* stream already closing */
        }
      }, 10_000)
      try {
        for await (const event of clientAssistantChatStream(
          ctx,
          {
            clientContactId,
            displayName: session.displayName,
            email: session.email,
          },
          { message: body.message as string, history },
        )) {
          send(event)
        }
      } catch (err) {
        send({
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        })
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
      'x-accel-buffering': 'no',
    },
  })
}
