// Contract W — the workflow runner's write operations.
//
// The matter page's in-place step runner (WORKFLOW-RUNNER-1) executes every step
// without navigating away. Its write operations are the Contract W REST endpoints
// shipped by BACKHALF-BLOCKS-1 (#318) — verified deployed, so the interim MCP
// second-path this module carried until then is retired (RUNNER-FIXES-1 WP5):
// the runner speaks Contract W only, and a rejection from a route is surfaced
// honestly, never papered over by another write path.
import { readDevSession } from './auth'
import { SessionExpiredError } from './mcpAttorney'

const IS_DEV = process.env.NODE_ENV !== 'production'

// POST to a Contract W REST endpoint using the same auth model as the MCP client
// (signed httpOnly cookie in prod; the demo shim headers in dev). Returns the
// parsed JSON body; throws with the route's error detail on any non-2xx.
async function postContractW<O>(path: string, body: unknown): Promise<O> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (IS_DEV) {
    const dev = readDevSession()
    if (dev) {
      headers['x-actor-id'] = dev.actorId
      headers['x-tenant-id'] = dev.tenantId
    }
  }
  const res = await fetch(path, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/'
    }
    throw new SessionExpiredError()
  }
  if (!res.ok) {
    let detail = ''
    try {
      const text = await res.text()
      const parsed = text ? JSON.parse(text) : null
      detail = parsed?.error ?? text
    } catch {
      /* ignore */
    }
    throw new Error(`Request failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  return (await res.json()) as O
}

// ── Approve (± send to client) ──────────────────────────────────────────────
// POST /api/attorney/documents/[versionId]/approve { send } → { approved, sent }
export interface ApproveResult {
  approved: boolean
  sent: boolean
}
export async function approveDocument(
  versionId: string,
  opts: { send: boolean },
): Promise<ApproveResult> {
  const r = await postContractW<{ approved?: boolean; sent?: boolean }>(
    `/api/attorney/documents/${versionId}/approve`,
    { send: opts.send },
  )
  return { approved: r.approved ?? true, sent: r.sent ?? opts.send }
}

// ── Regenerate (re-draft with change notes) ─────────────────────────────────
// POST /api/attorney/matters/[id]/steps/[stageKey]/regenerate { changeNotes }
// → 202 { jobId } — enqueued, not done; the worker writes version n+1.
export interface RegenerateResult {
  jobId: string | null
}
export async function regenerateStep(
  matterEntityId: string,
  stageKey: string,
  opts: { changeNotes: string },
): Promise<RegenerateResult> {
  const r = await postContractW<{ jobId?: string }>(
    `/api/attorney/matters/${matterEntityId}/steps/${encodeURIComponent(stageKey)}/regenerate`,
    { changeNotes: opts.changeNotes },
  )
  return { jobId: r.jobId ?? null }
}

// ── Skip a client step (attorney advances without client acceptance) ────────
// POST /api/attorney/matters/[id]/steps/[stageKey]/skip → { advancedTo }
export interface SkipResult {
  advancedTo: string | null
}
export async function skipStep(matterEntityId: string, stageKey: string): Promise<SkipResult> {
  const r = await postContractW<{ advancedTo?: string }>(
    `/api/attorney/matters/${matterEntityId}/steps/${encodeURIComponent(stageKey)}/skip`,
    {},
  )
  return { advancedTo: r.advancedTo ?? null }
}

// ── Record the client's out-of-band acceptance (RUNNER-FIXES-1 WP4) ─────────
// POST /api/attorney/matters/[id]/steps/[stageKey]/accept → { accepted, advancedTo }
// The attorney records that the client accepted by phone/email; fires
// legal.client_request.accept and advances the client gate.
export interface AcceptResult {
  accepted: boolean
  advancedTo: string | null
}
export async function acceptClientStep(
  matterEntityId: string,
  stageKey: string,
): Promise<AcceptResult> {
  const r = await postContractW<{ accepted?: boolean; advancedTo?: string | null }>(
    `/api/attorney/matters/${matterEntityId}/steps/${encodeURIComponent(stageKey)}/accept`,
    {},
  )
  return { accepted: r.accepted ?? true, advancedTo: r.advancedTo ?? null }
}

// ── Complete (+ archive) the matter ─────────────────────────────────────────
// POST /api/attorney/matters/[id]/complete { archive: true } → { completed, archived }
export interface CompleteResult {
  completed: boolean
  archived: boolean
}
export async function completeMatter(matterEntityId: string): Promise<CompleteResult> {
  const r = await postContractW<{ completed?: boolean; archived?: boolean }>(
    `/api/attorney/matters/${matterEntityId}/complete`,
    { archive: true },
  )
  return { completed: r.completed ?? true, archived: r.archived ?? true }
}
