import { readDevSession } from './auth'
import { SessionExpiredError } from './mcpAttorney'

const IS_DEV = process.env.NODE_ENV !== 'production'

export type WorkRate = 'quick' | 'balanced' | 'thorough'
// How much matter/client history the assistant is fed per turn (chat setting).
export type ContextDepth = 'lean' | 'balanced' | 'generous'

export interface AssistantStreamInput {
  message: string
  modelId: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  matterEntityId?: string
  contactEntityId?: string
  workRate?: WorkRate
  webSearch?: boolean
  useContext?: boolean
  contextDepth?: ContextDepth
  // Documents attached to this message (Claude only): each { name, text }.
  attachments?: Array<{ name: string; text: string }>
  pageContext?: { path?: string; [k: string]: unknown }
}

export interface StreamMeta {
  provider: string
  model: string
  kind: string
  scope: string
  webSearch: boolean
}

export interface StreamDone {
  eventId: string
  reply: string
  citations: string[]
  model: string
}

export interface AssistantStreamHandlers {
  onMeta?: (meta: StreamMeta) => void
  onThinking?: (text: string) => void
  onText?: (text: string) => void
  onDone?: (done: StreamDone) => void
  onError?: (message: string) => void
}

// Drive the attorney assistant streaming endpoint and fan the SSE events out to
// the handlers. Mirrors callAttorneyMcp's auth (signed cookie in prod; dev shim
// headers locally) and its 401 → bounce-to-sign-in behaviour.
export async function streamAssistant(
  input: AssistantStreamInput,
  handlers: AssistantStreamHandlers,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (IS_DEV) {
    const dev = readDevSession()
    if (dev) {
      headers['x-actor-id'] = dev.actorId
      headers['x-tenant-id'] = dev.tenantId
    }
  }

  const res = await fetch('/api/attorney/assistant/stream', {
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
      const parsed = JSON.parse(await res.text())
      detail = parsed?.error ?? ''
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
    // One SSE record is its `data:` line(s). We send a single-line JSON payload.
    const line = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!line) return
    const data = line.slice(5).trim()
    if (!data) return
    let evt: { type: string; [k: string]: unknown }
    try {
      evt = JSON.parse(data)
    } catch {
      return
    }
    switch (evt.type) {
      case 'meta':
        handlers.onMeta?.(evt as unknown as StreamMeta)
        break
      case 'thinking':
        handlers.onThinking?.(String(evt.text ?? ''))
        break
      case 'text':
        handlers.onText?.(String(evt.text ?? ''))
        break
      case 'done':
        handlers.onDone?.(evt as unknown as StreamDone)
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
    // Records are separated by a blank line (\n\n).
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const record = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      dispatch(record)
    }
  }
  if (buffer.trim()) dispatch(buffer)
}
