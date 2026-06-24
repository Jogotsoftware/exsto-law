import { readDevSession } from './auth'
import { SessionExpiredError } from './mcpAttorney'

const IS_DEV = process.env.NODE_ENV !== 'production'

// Drive the Templates "Draft / Enhance with AI" streaming endpoint. Streaming
// (vs. a single JSON call to the MCP tool) is what keeps a long document — an
// Operating Agreement, say — from tripping the serverless gateway's timeout (the
// 504 attorneys hit), and it lets the editor show the body as it's written. Auth
// mirrors callAttorneyMcp: the signed cookie in prod; dev shim headers locally.
export interface TemplateAiStreamInput {
  mode: 'draft' | 'enhance'
  category: 'document' | 'email'
  instructions?: string
  currentBody?: string
  fieldIds?: string[]
  skillSlugs?: string[]
  modelId?: string
}

export interface TemplateAiHandlers {
  onText?: (text: string) => void
  onThinking?: (text: string) => void
  onDone?: () => void
  onError?: (message: string) => void
}

export async function streamTemplateAi(
  input: TemplateAiStreamInput,
  handlers: TemplateAiHandlers,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (IS_DEV) {
    const dev = readDevSession()
    if (dev) {
      headers['x-actor-id'] = dev.actorId
      headers['x-tenant-id'] = dev.tenantId
    }
  }

  const res = await fetch('/api/attorney/templates/ai/stream', {
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
