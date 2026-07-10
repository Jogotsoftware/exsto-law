// Contract W — the workflow runner's write operations.
//
// The matter page's in-place step runner (WORKFLOW-RUNNER-1) executes every step
// without navigating away. Its four write operations are specified as Contract W
// REST endpoints, OWNED by a sibling session (BACKHALF-BLOCKS-1). Those routes may
// land after this UI does, so each function here:
//
//   1. calls the frozen Contract W endpoint at its exact shape, and
//   2. if that route is not deployed yet (404/405), falls back to the equivalent
//      EXISTING, proven MCP operation — a REAL action, never a simulation.
//
// This keeps the runner working today (via the MCP tools that already fire) and
// automatically upgrades to Contract W the moment the sibling session's routes go
// live — with no change here. A genuine backend error from a DEPLOYED route is
// surfaced honestly (we do NOT fall back past a route that exists and rejected).
//
// The only operation with no existing MCP equivalent is archive-on-complete: when
// Contract W is absent we complete the matter via the workflow advance (real) and
// report `archivePending: true` so the UI states plainly that archiving waits on
// Contract W. Nothing is faked.
import { readDevSession } from './auth'
import { callAttorneyMcp, SessionExpiredError } from './mcpAttorney'

const IS_DEV = process.env.NODE_ENV !== 'production'

// Which path actually performed the work — surfaced so the UI can be honest about
// archive-pending (fallback complete) without guessing.
export type RunVia = 'contract-w' | 'fallback'

// Raised when a deployed Contract W route rejects — carries the status so callers
// can distinguish "not built yet" (→ fallback) from "built and errored" (→ show).
class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RouteError'
  }
}

// POST to a Contract W REST endpoint using the same auth model as callAttorneyMcp
// (signed httpOnly cookie in prod; the demo shim headers in dev). Returns the
// parsed JSON body. Throws NotDeployed for 404/405 so callers fall back; throws
// RouteError for any other non-2xx (a real rejection from a live route).
class NotDeployedError extends Error {
  constructor(readonly path: string) {
    super(`Contract W endpoint not deployed: ${path}`)
    this.name = 'NotDeployedError'
  }
}

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
  // 404 (no route) / 405 (route file absent → method not allowed) ⇒ not deployed.
  if (res.status === 404 || res.status === 405) throw new NotDeployedError(path)
  if (!res.ok) {
    let detail = ''
    try {
      const text = await res.text()
      const parsed = text ? JSON.parse(text) : null
      detail = parsed?.error ?? text
    } catch {
      /* ignore */
    }
    throw new RouteError(res.status, `Request failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  return (await res.json()) as O
}

// ── Approve (± send to client) ──────────────────────────────────────────────
// Contract W: POST /api/attorney/documents/[versionId]/approve { send } → { approved, sent }
// Fallback: legal.draft.approve, then (send) legal.email.send_draft_link.
export interface ApproveResult {
  approved: boolean
  sent: boolean
  via: RunVia
}
export async function approveDocument(
  versionId: string,
  opts: { send: boolean; matterEntityId: string; shareUrl: string; to?: string | null },
): Promise<ApproveResult> {
  try {
    const r = await postContractW<{ approved?: boolean; sent?: boolean }>(
      `/api/attorney/documents/${versionId}/approve`,
      { send: opts.send },
    )
    return { approved: r.approved ?? true, sent: r.sent ?? opts.send, via: 'contract-w' }
  } catch (e) {
    if (!(e instanceof NotDeployedError)) throw e
    // Fallback: the exact operations the app already ships.
    await callAttorneyMcp({
      toolName: 'legal.draft.approve',
      input: { documentVersionId: versionId },
    })
    let sent = false
    if (opts.send) {
      if (!opts.to) {
        throw new Error(
          'Approved, but no client email on file to send to — add one, then send from the document.',
        )
      }
      await callAttorneyMcp({
        toolName: 'legal.email.send_draft_link',
        input: {
          matterEntityId: opts.matterEntityId,
          documentVersionId: versionId,
          shareUrl: opts.shareUrl,
          to: opts.to,
        },
      })
      sent = true
    }
    return { approved: true, sent, via: 'fallback' }
  }
}

// ── Regenerate (re-draft with change notes) ─────────────────────────────────
// Contract W: POST /api/attorney/matters/[id]/steps/[stageKey]/regenerate { changeNotes } → { jobId }
// Fallback: legal.draft.generate { guidance: changeNotes } (enqueues the worker).
export interface RegenerateResult {
  jobId: string | null
  via: RunVia
}
export async function regenerateStep(
  matterEntityId: string,
  stageKey: string,
  opts: { changeNotes: string; documentKind: string; skillSlugs?: string[] },
): Promise<RegenerateResult> {
  try {
    const r = await postContractW<{ jobId?: string }>(
      `/api/attorney/matters/${matterEntityId}/steps/${encodeURIComponent(stageKey)}/regenerate`,
      { changeNotes: opts.changeNotes },
    )
    return { jobId: r.jobId ?? null, via: 'contract-w' }
  } catch (e) {
    if (!(e instanceof NotDeployedError)) throw e
    await callAttorneyMcp({
      toolName: 'legal.draft.generate',
      input: {
        matterEntityId,
        documentKind: opts.documentKind,
        guidance: opts.changeNotes || undefined,
        skillSlugs: opts.skillSlugs && opts.skillSlugs.length ? opts.skillSlugs : undefined,
      },
    })
    return { jobId: null, via: 'fallback' }
  }
}

// ── Skip a client step (attorney advances without client acceptance) ────────
// Contract W: POST /api/attorney/matters/[id]/steps/[stageKey]/skip → { advancedTo }
// Fallback: legal.matter.advance along the step's client edge.
export interface SkipResult {
  advancedTo: string | null
  via: RunVia
}
export async function skipStep(
  matterEntityId: string,
  stageKey: string,
  fallback: { toState: string; gate: string },
): Promise<SkipResult> {
  try {
    const r = await postContractW<{ advancedTo?: string }>(
      `/api/attorney/matters/${matterEntityId}/steps/${encodeURIComponent(stageKey)}/skip`,
      {},
    )
    return { advancedTo: r.advancedTo ?? null, via: 'contract-w' }
  } catch (e) {
    if (!(e instanceof NotDeployedError)) throw e
    await callAttorneyMcp({
      toolName: 'legal.matter.advance',
      input: {
        matterEntityId,
        toState: fallback.toState,
        gate: fallback.gate,
        trigger: 'skip',
      },
    })
    return { advancedTo: fallback.toState, via: 'fallback' }
  }
}

// ── Complete (+ archive) the matter ─────────────────────────────────────────
// Contract W: POST /api/attorney/matters/[id]/complete { archive: true } → { completed }
// Fallback: legal.matter.advance to the terminal stage (real completion). No MCP
// archive exists, so when Contract W is absent we report archivePending: true —
// the matter IS completed, archiving waits on the endpoint.
export interface CompleteResult {
  completed: boolean
  archived: boolean
  archivePending: boolean
  via: RunVia
}
export async function completeMatter(
  matterEntityId: string,
  opts: { terminalState: string | null; terminalGate?: string },
): Promise<CompleteResult> {
  try {
    const r = await postContractW<{ completed?: boolean; archived?: boolean }>(
      `/api/attorney/matters/${matterEntityId}/complete`,
      { archive: true },
    )
    return {
      completed: r.completed ?? true,
      archived: r.archived ?? true,
      archivePending: false,
      via: 'contract-w',
    }
  } catch (e) {
    if (!(e instanceof NotDeployedError)) throw e
    if (!opts.terminalState) {
      throw new Error(
        'This matter has no terminal step to advance to, and the completion endpoint is not available yet.',
      )
    }
    await callAttorneyMcp({
      toolName: 'legal.matter.advance',
      input: {
        matterEntityId,
        toState: opts.terminalState,
        gate: opts.terminalGate ?? 'attorney',
        trigger: 'complete',
      },
    })
    return { completed: true, archived: false, archivePending: true, via: 'fallback' }
  }
}
