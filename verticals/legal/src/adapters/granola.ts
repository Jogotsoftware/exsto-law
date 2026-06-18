// Granola adapter face — WP1.2. Granola is now reached EXCLUSIVELY through its
// remote MCP server over per-attorney OAuth (granolaOAuth.ts + granolaMcp.ts).
// The legacy api-key REST integration (public-api.granola.ai, GRANOLA_API_KEY)
// has been REMOVED — Granola offers no api-key/service-account access for MCP, and
// the product decision was a clean cut with no fallback. The data functions below
// keep their original signatures (callers + the import/ingestion flows are
// unchanged) and delegate to the MCP client.
//
// This module still owns two things that are NOT part of the OAuth credential:
//   - the inbound-webhook HMAC verification (verifyGranolaSignature), and
//   - the transcript payload normalizer + data shapes (re-exported from
//     granolaShapes.ts), shared with the MCP client.
//
// ⚠️ The live MCP path is activation-gated (an attorney must complete the Granola
// browser OAuth); see granolaMcp.ts / granolaOAuth.ts.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { loadConnection } from './connectionStore.js'
import {
  mcpFetchTranscript,
  mcpGetNote,
  mcpListFolders,
  mcpListNotesInFolder,
  type GranolaSecret,
} from './granolaMcp.js'

// Data shapes + the field-tolerant normalizer live in a leaf module so both this
// face and the MCP client can use them without a cycle. Re-exported here because
// callers (granolaIngestion, granolaImport) and tests import them from this path.
export {
  normalizeGranolaPayload,
  type GranolaCallData,
  type GranolaFolder,
  type GranolaNoteSummary,
  type GranolaNoteDetail,
} from './granolaShapes.js'

// ── Inbound webhook verification (orthogonal to the OAuth credential) ─────────

// The webhook signing secret. It is not part of the OAuth grant: it rides in the
// connection's Vault record if set, else a firm-level env var. (The api-key
// Settings form that used to set it is gone; configure GRANOLA_WEBHOOK_SECRET.)
export async function granolaWebhookSecret(
  tenantId: string,
  actorId?: string | null,
): Promise<string | null> {
  const conn = await loadConnection<GranolaSecret>(tenantId, 'granola', actorId)
  return conn?.secret.webhook_secret ?? process.env.GRANOLA_WEBHOOK_SECRET ?? null
}

// HMAC-SHA256 signature check over the raw request body. Constant-time
// comparison; accepts an optional "sha256=" prefix on the header value.
export function verifyGranolaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const given = signatureHeader.replace(/^sha256=/, '').trim()
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(given, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── Data functions (MCP-backed; signatures unchanged from the REST era) ───────

// Fetch the full call data (transcript + metadata) for a Granola meeting/note.
export function fetchGranolaCall(
  tenantId: string,
  callId: string,
  actorId?: string | null,
): ReturnType<typeof mcpFetchTranscript> {
  return mcpFetchTranscript(tenantId, callId, actorId)
}

export function listGranolaFolders(
  tenantId: string,
  actorId?: string | null,
): ReturnType<typeof mcpListFolders> {
  return mcpListFolders(tenantId, actorId)
}

export function listGranolaNotesInFolder(
  tenantId: string,
  folderId: string,
  actorId?: string | null,
): ReturnType<typeof mcpListNotesInFolder> {
  return mcpListNotesInFolder(tenantId, folderId, actorId)
}

export function getGranolaNote(
  tenantId: string,
  noteId: string,
  opts?: { transcript?: boolean },
  actorId?: string | null,
): ReturnType<typeof mcpGetNote> {
  return mcpGetNote(tenantId, noteId, opts, actorId)
}
