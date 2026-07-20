import { readDevSession } from './auth'
import { SessionExpiredError } from './mcpAttorney'

const IS_DEV = process.env.NODE_ENV !== 'production'

// Drive the compose modal's "Draft with AI" streaming endpoint
// (/api/attorney/mail/ai/stream). The model emits `SUBJECT: …` on the first
// line, a blank line, then the body — split it client-side with
// splitComposeDraft. Auth mirrors templateAiStream/callAttorneyMcp: the signed
// cookie in prod; dev shim headers locally.
export interface MailAiStreamInput {
  instructions: string
  matterEntityId?: string
  clientEntityId?: string
}

export interface MailAiHandlers {
  onText?: (text: string) => void
  onThinking?: (text: string) => void
  onDone?: () => void
  onError?: (message: string) => void
}

// Split accumulated draft text into subject/body while it streams. Tolerant of
// a partial first line (no newline yet → everything is still subject-pending).
// The model's output contract (email-drafting-prompt.md) trails the body with a
// `---` rule + ```json reasoning-trace block — the worker path parses that into
// a trace, but here it would land in the attorney's draft box, so cut it the
// moment its marker appears (mid-stream too, keeping the preview clean).
export function splitComposeDraft(accumulated: string): { subject: string; body: string } {
  const m = /^\s*SUBJECT:\s*(.*)(?:\n+([\s\S]*))?$/i.exec(accumulated)
  const subject = m ? (m[1] ?? '').trim() : ''
  let body = m ? (m[2] ?? '') : accumulated
  const rule = body.search(/\n\s*-{3,}\s*\n\s*```json/i)
  if (rule >= 0) body = body.slice(0, rule)
  else {
    const fence = body.search(/\n\s*```json\s*\n\s*\{/i)
    if (fence >= 0) body = body.slice(0, fence)
  }
  return { subject, body: body.replace(/\n\s*-{3,}\s*$/, '').trimEnd() }
}

export async function streamMailAi(
  input: MailAiStreamInput,
  handlers: MailAiHandlers,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (IS_DEV) {
    const dev = readDevSession()
    if (dev) {
      headers['x-actor-id'] = dev.actorId
      headers['x-tenant-id'] = dev.tenantId
    }
  }

  const res = await fetch('/api/attorney/mail/ai/stream', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })

  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/'
    }
    throw new SessionExpiredError()
  }
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (JSON.parse(await res.text()) as { error?: string })?.error ?? ''
    } catch {
      // ignore
    }
    handlers.onError?.(detail || `Request failed (${res.status})`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (raw: string) => {
    const line = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!line) return
    const data = line.slice(5).trim()
    if (!data) return
    let evt: { type?: string; [k: string]: unknown }
    try {
      evt = JSON.parse(data)
    } catch {
      return
    }
    switch (evt.type) {
      case 'text':
        handlers.onText?.(String(evt.text ?? ''))
        break
      case 'thinking':
        handlers.onThinking?.(String(evt.text ?? ''))
        break
      case 'done':
        handlers.onDone?.()
        break
      case 'error':
        handlers.onError?.(String(evt.message ?? 'Something went wrong.'))
        break
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const record = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      dispatch(record)
    }
  }
  if (buffer.trim()) dispatch(buffer)
}
