'use client'

import { useEffect, useState } from 'react'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'

interface MeResponse {
  email: string
  displayName: string
  matterCount: number
}

interface MatterListItem {
  matterEntityId: string
  matterNumber: string
  statusKey: string
  statusLabel: string
}

interface Milestone {
  key: string
  label: string
  occurredAt: string
}

interface Timeline {
  matterNumber: string
  statusKey: string
  statusLabel: string
  scheduledAt: string | null
  milestones: Milestone[]
}

// Signed-in client portal. Read-only: a matter switcher (when the client has
// more than one matter), the current status, and a whitelisted milestone
// timeline. All identity comes from the httpOnly cookie; this page sends no
// identity — the server derives it.
export default function ClientPortalPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [matters, setMatters] = useState<MatterListItem[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 1. Confirm we're signed in (display fields) — bounce to login on 401.
  useEffect(() => {
    fetch('/api/client/auth/me', { credentials: 'same-origin' })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/portal/login'
          return null
        }
        return res.json()
      })
      .then((body: MeResponse | null) => {
        if (body) setMe(body)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // 2. Load the client's matters once signed in.
  useEffect(() => {
    if (!me) return
    callClientPortalMcp<{ matters: MatterListItem[] }>({ toolName: 'legal.client.matters' })
      .then((r) => {
        setMatters(r.matters)
        if (r.matters.length > 0) setSelected(r.matters[0]!.matterEntityId)
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [me])

  // 3. Load the selected matter's timeline.
  useEffect(() => {
    if (!selected) return
    setTimeline(null)
    callClientPortalMcp<{ timeline: Timeline | null }>({
      toolName: 'legal.client.matter_timeline',
      input: { matterEntityId: selected },
    })
      .then((r) => setTimeline(r.timeline))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [selected])

  if (error) {
    return (
      <main className="public-draft">
        <div className="alert alert-error">{error}</div>
      </main>
    )
  }

  if (!me || !matters) {
    return (
      <main className="public-draft">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )
  }

  return (
    <main className="public-draft">
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>Your matters</h1>
          <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
            Signed in as {me.displayName} ({me.email})
          </div>
        </div>
        <div className="public-draft-actions">
          <a href="/api/client/auth/logout">Sign out</a>
        </div>
      </div>

      {matters.length === 0 ? (
        <p style={{ marginTop: 'var(--space-4)' }}>
          You don&apos;t have any matters with the firm yet.
        </p>
      ) : (
        <>
          {matters.length > 1 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <label htmlFor="matter-switch" className="text-sm">
                Matter
              </label>
              <select
                id="matter-switch"
                value={selected ?? ''}
                onChange={(e) => setSelected(e.target.value)}
                style={{ display: 'block', marginTop: 'var(--space-1)' }}
              >
                {matters.map((m) => (
                  <option key={m.matterEntityId} value={m.matterEntityId}>
                    {m.matterNumber} — {m.statusLabel}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!timeline ? (
            <div className="loading-block" style={{ marginTop: 'var(--space-4)' }}>
              <span className="spinner" /> Loading matter…
            </div>
          ) : (
            <section style={{ marginTop: 'var(--space-4)' }}>
              <h2 style={{ margin: 0 }}>Matter {timeline.matterNumber}</h2>
              <div className="text-sm" style={{ marginTop: 'var(--space-1)' }}>
                Status: <strong>{timeline.statusLabel}</strong>
              </div>
              {timeline.scheduledAt && (
                <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
                  Consultation: {new Date(timeline.scheduledAt).toLocaleString()}
                </div>
              )}

              <h3 style={{ marginTop: 'var(--space-4)' }}>Timeline</h3>
              {timeline.milestones.length === 0 ? (
                <p className="text-muted">No updates yet.</p>
              ) : (
                <ol style={{ marginTop: 'var(--space-2)' }}>
                  {timeline.milestones.map((m, i) => (
                    <li key={`${m.key}-${i}`} style={{ marginBottom: 'var(--space-2)' }}>
                      <div>{m.label}</div>
                      <div className="text-sm text-muted">
                        {new Date(m.occurredAt).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </>
      )}
    </main>
  )
}
