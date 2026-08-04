'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { buildFirmBookingUrl, useFirmPublicSlug } from '@/lib/firmBookingLink'
import { CalendarWorkspace } from '@/components/CalendarWorkspace'
import { ChevronDownIcon, ChevronRightIcon, ClockIcon, Share2Icon } from '@/components/icons'
import { parseTimestamp } from '@/lib/datetime'
import { stageStyle, stageFilterLabel, STAGE_CATEGORIES, type Stage } from '@/lib/matterStage'

// Copies the public booking-page link to the clipboard. Replaces the old
// "/attorney/share" link, which 404'd (no such route) — the link prospects use
// to book is the public /book page. MULTI-TENANT-1: the link carries THIS firm's
// slug (?firm=…) so a prospect lands on the attorney's own firm, not the default.
function ShareBookingButton() {
  const [copied, setCopied] = useState(false)
  const slug = useFirmPublicSlug()
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildFirmBookingUrl(window.location.origin, slug))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" onClick={copy} className="li-dash-share">
      <Share2Icon size={14} />
      {copied ? 'Link copied!' : 'Share a booking link'}
    </button>
  )
}

// One row of the home Tasks panel — the same rows the Task Queue aggregates
// (legal.attorney.task_queue), sorted by due date. Mirrors the server-side
// AttorneyTask shape (client components read it over MCP).
interface HomeTask {
  id: string
  type: string
  typeLabel: string
  title: string
  clientName: string | null
  matterNumber: string | null
  dueDate: string | null
  dateLabel: string
  workHref: string
}

interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  practiceArea: string
  status: string
  // The display STATUS — derived from the matter's live workflow, server-side.
  stage: Stage
  summary: string
  createdAt: string
}

// FB-H — one pressing item from the attention engine (legal.attention.feed).
interface AttentionItem {
  kind: string
  title: string
  why: string
  deepLink: string
  rank: number
  occurredAt: string
  entityId?: string
}

// Short chip label + status-token colors per kind, so the card reads at a glance
// which KIND of pressing thing each row is. Colors reuse the shared li- status
// pairs (same tokens the matters table uses). Unknown kinds fall back to neutral.
const ATTENTION_KIND_META: Record<string, { label: string; fg: string; bg: string }> = {
  overdue_task: { label: 'Overdue', fg: 'var(--li-danger)', bg: 'var(--li-danger-bg)' },
  awaiting_reply: { label: 'Reply', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  draft_pending_review: { label: 'Review', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  envelope_unsigned: { label: 'Unsigned', fg: 'var(--li-info)', bg: 'var(--li-info-bg)' },
  invoice_unpaid: { label: 'Unpaid', fg: 'var(--li-info)', bg: 'var(--li-info-bg)' },
  workflow_parked: { label: 'Stuck', fg: 'var(--li-neutral)', bg: 'var(--li-neutral-bg)' },
  stale_matter: { label: 'No Activity', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
  due_soon_task: { label: 'Due Soon', fg: 'var(--li-neutral)', bg: 'var(--li-neutral-bg)' },
}

function attentionKindMeta(kind: string): { label: string; fg: string; bg: string } {
  return (
    ATTENTION_KIND_META[kind] ?? {
      label: 'Attention',
      fg: 'var(--li-muted)',
      bg: 'var(--li-border-soft)',
    }
  )
}

// The matters table's STATUS chip + filter now come from each matter's derived
// `stage` (@/lib/matterStage), which reads the matter's live workflow — the same
// shared helper the matters list uses, so a matter reads identically on both. The
// old hardcoded status→bucket map lived here and collapsed every real workflow
// state to "New Inquiry".

// Gmail-style short date for the matters table's DATE column: "Jan 12", or with a
// year once it's not the current one. Same convention as the mail inbox.
function formatDateShort(iso: string): string {
  const d = parseTimestamp(iso)
  if (!d) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

export default function AttorneyHome() {
  const [tasks, setTasks] = useState<HomeTask[] | null>(null)
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [attention, setAttention] = useState<AttentionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dashStatusFilter, setDashStatusFilter] = useState('')
  const [dashSortDir, setDashSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    Promise.all([
      // The home Tasks panel — the same queue the Tasks page aggregates.
      callAttorneyMcp<{ tasks: HomeTask[] }>({ toolName: 'legal.attorney.task_queue' }).then((r) =>
        setTasks(r.tasks),
      ),
      callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' }).then((m) =>
        setMatters(m.matters),
      ),
      // FB-H — the attention feed for the "Attention" card (top pressing items).
      // Non-fatal: a feed hiccup must not blank the whole dashboard.
      callAttorneyMcp<{ items: AttentionItem[] }>({
        toolName: 'legal.attention.feed',
        input: { limit: 6 },
      })
        .then((r) => setAttention(r.items))
        .catch(() => setAttention([])),
    ]).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Tasks panel rows: soonest due first; anything undated sinks to the end.
  const dueTasks = useMemo(() => {
    const list = [...(tasks ?? [])]
    return list.sort((a, b) => {
      const ta = a.dueDate ? (parseTimestamp(a.dueDate)?.getTime() ?? Infinity) : Infinity
      const tb = b.dueDate ? (parseTimestamp(b.dueDate)?.getTime() ?? Infinity) : Infinity
      return ta - tb
    })
  }, [tasks])

  const dashMatters = useMemo(() => {
    const rows = (matters ?? []).filter(
      (m) => !dashStatusFilter || m.stage.category === dashStatusFilter,
    )
    const dir = dashSortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const ta = parseTimestamp(a.createdAt)?.getTime() ?? 0
      const tb = parseTimestamp(b.createdAt)?.getTime() ?? 0
      return (ta - tb) * dir
    })
  }, [matters, dashStatusFilter, dashSortDir])

  function toggleDashSort() {
    setDashSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  return (
    <main>
      {/* Beta feedback: drop the "Hi, Juan Carlos" greeting and the share-booking
          button from this row. A neutral title keeps the page's h1 for
          structure/a11y; the booking link is still shareable from the "This week"
          row below. */}
      <h1 className="li-dash-title">Home</h1>

      {error && <div className="alert alert-error">{error}</div>}

      {/* FB-H — the ATTENTION card: the attorney's most pressing items, ranked by
          the deterministic attention engine, each a click straight to where to
          act. Rendered above the grid so it's the first thing the attorney sees.
          Hidden entirely when nothing is pressing (an empty feed is good news). */}
      {attention === null && !error && (
        <section className="li-dash-card li-attn-card">
          <h2 className="li-dash-card-title">Attention</h2>
          <div className="loading-block" role="status">
            <span className="spinner" /> Loading…
          </div>
        </section>
      )}
      {attention && attention.length > 0 && (
        <section className="li-dash-card li-attn-card">
          <h2 className="li-dash-card-title">Attention</h2>
          <p className="li-attn-sub">Your most pressing items, most pressing first.</p>
          <div className="li-attn-list">
            {attention.map((it) => {
              const meta = attentionKindMeta(it.kind)
              return (
                <Link
                  key={`${it.kind}:${it.deepLink}:${it.entityId ?? it.rank}`}
                  href={it.deepLink}
                  className="li-attn-row"
                >
                  <span className="li-attn-kind" style={{ background: meta.bg, color: meta.fg }}>
                    <span className="li-attn-dot" style={{ background: meta.fg }} />
                    {meta.label}
                  </span>
                  <span className="li-attn-why">{it.why}</span>
                  <ChevronRightIcon size={15} className="li-attn-chevron" />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <div className="li-dash-grid">
        <section className="li-dash-card">
          <h2 className="li-dash-card-title">Matters</h2>
          <div className="li-dash-mheader">
            <span className="li-dash-mheader-label">Matter</span>
            <button
              type="button"
              className="li-dash-sort"
              onClick={toggleDashSort}
              title="Sort by date"
              aria-label={`Sort matters by date, currently ${dashSortDir === 'desc' ? 'newest first' : 'oldest first'}`}
            >
              Date
              <ChevronDownIcon
                size={12}
                style={{ transform: dashSortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
              />
            </button>
            <span className="li-dash-statusfilter">
              <select
                value={dashStatusFilter}
                onChange={(e) => setDashStatusFilter(e.target.value)}
                aria-label="Filter matters by status"
              >
                <option value="">All statuses</option>
                {STAGE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {stageFilterLabel(c)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={12} />
            </span>
          </div>
          {matters === null && !error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}
          {matters && dashMatters.length === 0 && (
            <p className="li-dash-empty">No matters match this filter.</p>
          )}
          {matters && dashMatters.length > 0 && (
            <div className="li-dash-mbody">
              {dashMatters.map((m) => {
                const chip = stageStyle(m.stage.category)
                return (
                  <Link
                    key={m.matterEntityId}
                    href={`/attorney/matters/${m.matterEntityId}`}
                    className="li-dash-mrow"
                  >
                    <span className="li-dash-mclient">
                      <span className="li-dash-dot" style={{ background: chip.fg }} />
                      <span className="li-dash-mclient-text">
                        <span className="li-dash-mname">{m.clientName || m.matterNumber}</span>
                        <span className="li-dash-mnum">{m.matterNumber}</span>
                      </span>
                    </span>
                    <span className="li-dash-mdate">{formatDateShort(m.createdAt)}</span>
                    <span
                      className="li-dash-mstatus"
                      style={{ background: chip.bg, color: chip.fg }}
                    >
                      <span className="li-dash-mstatus-dot" style={{ background: chip.fg }} />
                      {m.stage.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section className="li-dash-card">
          <div className="li-dash-card-head">
            <h2 className="li-dash-card-title">Tasks</h2>
            <Link href="/attorney/review" className="li-dash-card-link">
              View all
              <ChevronRightIcon size={14} />
            </Link>
          </div>
          {tasks === null && !error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}
          {tasks && tasks.length === 0 && (
            <p className="li-dash-empty">Nothing waiting on you right now.</p>
          )}
          {tasks && tasks.length > 0 && (
            <div className="li-dash-rbody">
              {dueTasks.map((t) => (
                <Link key={`${t.type}:${t.id}`} href={t.workHref} className="li-dash-rrow">
                  <span className="li-dash-rmain">
                    <span className="li-dash-rclient">{t.title}</span>
                    <span className="li-dash-rservice">
                      {t.typeLabel}
                      {t.clientName ? ` · ${t.clientName}` : ''}
                    </span>
                  </span>
                  <span className="li-dash-rtime">
                    <ClockIcon size={12} />
                    {t.dateLabel === 'Due' ? 'Due ' : ''}
                    {formatDateShort(t.dueDate ?? '')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* UIWALK-1: the home calendar IS the Calendar page — the identical
          component, embedded (h1 suppressed). Same views, drag-to-edit, event
          modal, everything. */}
      <section className="li-dash-week">
        <div className="li-dash-week-head">
          <h2 className="li-dash-card-title li-dash-week-title">Calendar</h2>
          <ShareBookingButton />
        </div>
        <CalendarWorkspace embedded />
      </section>
    </main>
  )
}
