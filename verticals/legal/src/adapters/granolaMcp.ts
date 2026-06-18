// Granola MCP client — WP1.2. The data layer that replaces the retired api-key
// REST adapter. Talks to Granola's remote MCP server (https://mcp.granola.ai/mcp,
// Streamable HTTP) with the attorney's OAuth bearer (Vault, per migration 0016).
//
// ⚠️ ACTIVATION-GATED / UNVERIFIED: exercised only against a live Granola account
// after the attorney completes the browser OAuth (granolaOAuth.ts). The MCP tool
// names are Granola's documented set (get_account_info, list_meeting_folders,
// list_meetings, get_meetings, get_meeting_transcript); the result→shape mapping
// is defensive (reusing normalizeGranolaPayload for transcripts) because Granola's
// MCP output schema is not pinned. There is NO api-key fallback (product decision).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadConnection, saveConnection } from './connectionStore.js'
import { refreshGranolaTokens } from './granolaOAuth.js'
import {
  normalizeGranolaPayload,
  type GranolaCallData,
  type GranolaFolder,
  type GranolaNoteSummary,
  type GranolaNoteDetail,
} from './granolaShapes.js'

const MCP_URL = new URL(process.env.GRANOLA_MCP_URL ?? 'https://mcp.granola.ai/mcp')
// Refresh a little before expiry so an in-flight call doesn't race the deadline.
const EXPIRY_SKEW_MS = 60_000

// What the OAuth connect stores in Vault for 'granola'. clientId is kept so refresh
// (which needs the same client) works for a DCR-issued public client too.
export interface GranolaSecret {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO
  clientId: string
  scope?: string | null
  // Inbound-webhook HMAC secret (orthogonal to the OAuth credential); preserved
  // across token rotation if present.
  webhook_secret?: string
}

function notConnected(): never {
  throw new Error('Granola is not connected. Connect Granola from Settings → Integrations.')
}

async function persistGranolaTokens(
  tenantId: string,
  actorId: string | null | undefined,
  next: { accessToken: string; refreshToken: string; expiresAt: string; scope?: string | null },
  prior: GranolaSecret,
): Promise<void> {
  const secret: GranolaSecret = {
    accessToken: next.accessToken,
    refreshToken: next.refreshToken,
    expiresAt: next.expiresAt,
    clientId: prior.clientId,
    scope: next.scope ?? prior.scope ?? null,
    ...(prior.webhook_secret ? { webhook_secret: prior.webhook_secret } : {}),
  }
  await saveConnection(
    tenantId,
    'granola',
    secret,
    { scope: secret.scope ?? null, expiresAt: new Date(secret.expiresAt) },
    actorId,
  )
}

// Load a usable access token, refreshing (and persisting the rotated refresh
// token) when the stored one is at/near expiry.
async function accessTokenFor(tenantId: string, actorId?: string | null): Promise<string> {
  const conn = await loadConnection<GranolaSecret>(tenantId, 'granola', actorId)
  if (!conn?.secret?.accessToken || !conn.secret.refreshToken) notConnected()
  const s = conn.secret
  const expiresMs = new Date(s.expiresAt).getTime()
  if (Number.isFinite(expiresMs) && expiresMs - EXPIRY_SKEW_MS > Date.now()) {
    return s.accessToken
  }
  const rotated = await refreshGranolaTokens({ refreshToken: s.refreshToken, clientId: s.clientId })
  await persistGranolaTokens(tenantId, actorId, rotated, s)
  return rotated.accessToken
}

async function withGranolaClient<T>(
  accessToken: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const client = new Client({ name: 'exsto-law', version: '0.1.0' })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

// Extract a JSON-ish payload from an MCP tool result: structuredContent if the
// server returns it, else the parsed text content blocks.
function toolJson(result: unknown): unknown {
  const r = result as {
    structuredContent?: unknown
    content?: Array<{ type?: string; text?: string }>
  }
  if (r.structuredContent !== undefined) return r.structuredContent
  const text = (r.content ?? [])
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function callTool(
  tenantId: string,
  actorId: string | null | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessTokenFor(tenantId, actorId)
  return withGranolaClient(token, async (client) => {
    const result = await client.callTool({ name, arguments: args })
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Granola MCP tool ${name} returned an error.`)
    }
    return toolJson(result)
  })
}

// ── Capability probe ──────────────────────────────────────────────────────────
// A real authenticated MCP call (account info). Passing means the OAuth grant
// actually works — the gate before a connection is marked 'connected'.
export async function probeGranola(
  tenantId: string,
  actorId?: string | null,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await callTool(tenantId, actorId, 'get_account_info', {})
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

// Probe with an in-hand access token (no Vault read) — used at connect time to
// gate 'connected' on a real MCP call BEFORE the credential is persisted, exactly
// like the Google dual probe.
export async function probeGranolaToken(
  accessToken: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await withGranolaClient(accessToken, async (client) => {
      const r = await client.callTool({ name: 'get_account_info', arguments: {} })
      if ((r as { isError?: boolean }).isError)
        throw new Error('get_account_info returned an error')
      return r
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

// ── Data functions (same shapes the old REST adapter returned) ────────────────

export async function mcpFetchTranscript(
  tenantId: string,
  callId: string,
  actorId?: string | null,
): Promise<GranolaCallData> {
  // Merge meeting metadata + transcript into one payload, then reuse the proven,
  // field-name-tolerant normalizer.
  const meeting = (await callTool(tenantId, actorId, 'get_meetings', { id: callId })) as Record<
    string,
    unknown
  > | null
  const transcript = (await callTool(tenantId, actorId, 'get_meeting_transcript', {
    meeting_id: callId,
  })) as Record<string, unknown> | string | null

  const payload: Record<string, unknown> = { ...(meeting ?? {}), id: callId }
  if (typeof transcript === 'string') payload.transcript = transcript
  else if (transcript) Object.assign(payload, transcript)

  const normalized = normalizeGranolaPayload(payload)
  if (!normalized) {
    throw new Error(`Granola MCP returned no recognizable transcript for meeting ${callId}.`)
  }
  return normalized
}

export async function mcpListFolders(
  tenantId: string,
  actorId?: string | null,
): Promise<GranolaFolder[]> {
  const data = (await callTool(tenantId, actorId, 'list_meeting_folders', {})) as
    | { folders?: unknown[] }
    | unknown[]
    | null
  const rows = Array.isArray(data) ? data : (data?.folders ?? [])
  return (rows as Array<Record<string, unknown>>)
    .map((raw) => {
      const id = typeof raw.id === 'string' ? raw.id : null
      if (!id) return null
      return { id, name: typeof raw.name === 'string' ? raw.name : '(untitled folder)' }
    })
    .filter((f): f is GranolaFolder => f !== null)
}

export async function mcpListNotesInFolder(
  tenantId: string,
  folderId: string,
  actorId?: string | null,
): Promise<GranolaNoteSummary[]> {
  const data = (await callTool(tenantId, actorId, 'list_meetings', { folder_id: folderId })) as
    | { meetings?: unknown[]; notes?: unknown[] }
    | unknown[]
    | null
  const rows = Array.isArray(data) ? data : (data?.meetings ?? data?.notes ?? [])
  return (rows as Array<Record<string, unknown>>)
    .map((raw) => {
      const id = typeof raw.id === 'string' ? raw.id : null
      if (!id) return null
      const owner = (raw.owner ?? null) as { email?: unknown } | null
      return {
        id,
        title: typeof raw.title === 'string' && raw.title ? raw.title : '(untitled note)',
        createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
        ownerEmail: owner && typeof owner.email === 'string' ? owner.email.toLowerCase() : null,
      }
    })
    .filter((n): n is GranolaNoteSummary => n !== null)
}

export async function mcpGetNote(
  tenantId: string,
  noteId: string,
  opts: { transcript?: boolean } | undefined,
  actorId?: string | null,
): Promise<GranolaNoteDetail> {
  const meeting = (await callTool(tenantId, actorId, 'get_meetings', { id: noteId })) as Record<
    string,
    unknown
  > | null
  let transcriptText = ''
  if (opts?.transcript) {
    const t = (await callTool(tenantId, actorId, 'get_meeting_transcript', {
      meeting_id: noteId,
    })) as Record<string, unknown> | string | null
    const merged: Record<string, unknown> = { ...(meeting ?? {}), id: noteId }
    if (typeof t === 'string') merged.transcript = t
    else if (t) Object.assign(merged, t)
    transcriptText = normalizeGranolaPayload(merged)?.transcriptText ?? ''
  }

  const m = meeting ?? {}
  const emails = new Set<string>()
  const addEmail = (v: unknown) => {
    if (typeof v === 'string' && v.includes('@')) emails.add(v.toLowerCase().trim())
  }
  const attendees = Array.isArray(m.attendees) ? (m.attendees as Array<{ email?: unknown }>) : []
  for (const a of attendees) addEmail(a?.email)

  return {
    id: typeof m.id === 'string' ? m.id : noteId,
    title: typeof m.title === 'string' && m.title ? m.title : '(untitled note)',
    startedAt:
      (typeof m.scheduled_start_time === 'string' ? m.scheduled_start_time : null) ??
      (typeof m.created_at === 'string' ? m.created_at : null),
    attendeeEmails: [...emails],
    transcriptText,
    summaryMarkdown: typeof m.summary_markdown === 'string' ? m.summary_markdown : null,
  }
}
