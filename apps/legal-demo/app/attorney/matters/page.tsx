'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { PlusIcon, SearchIcon, ChevronDownIcon } from '@/components/icons'
import { serviceLabel, useServiceDisplayNames } from '@/lib/serviceLabel'

interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  practiceArea: string
  status: string
  summary: string
  createdAt: string
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

// Status→color buckets for the MATTER chip (li-mat-status), matching the Home
// dashboard's matters table (attorney/page.tsx STATUS_GROUPS) so the same status
// reads the same color everywhere. Duplicated rather than imported — each surface
// in this redesign owns its own small helpers (see matters/[id]/page.tsx).
const STATUS_GROUPS: Array<{
  key: string
  chipLabel: string
  matches: (s: string) => boolean
  fg: string
  bg: string
}> = [
  {
    key: 'inquiry',
    chipLabel: 'New inquiry',
    matches: (s) =>
      s === 'inquiry' || s === 'questionnaire_pending' || s === 'questionnaire_submitted',
    // Comp's matters table (legal-instruments.dc.html stBadge) pairs "New inquiry"
    // with a neutral gray, not the purple used for a genuine in-review status.
    fg: 'var(--li-neutral)',
    bg: 'var(--li-neutral-bg)',
  },
  {
    key: 'scheduled',
    chipLabel: 'Consultation booked',
    matches: (s) => s === 'consultation_scheduled' || s === 'consultation_completed',
    fg: 'var(--li-info)',
    bg: 'var(--li-info-bg)',
  },
  {
    key: 'drafting',
    chipLabel: 'Drafting',
    matches: (s) => s === 'drafting' || s === 'review_pending',
    fg: 'var(--li-warn)',
    bg: 'var(--li-warn-bg)',
  },
  {
    key: 'active',
    chipLabel: 'Active',
    matches: (s) => s === 'engagement_signed' || s === 'matter_active',
    fg: 'var(--li-ok)',
    bg: 'var(--li-ok-bg)',
  },
  {
    key: 'closed',
    chipLabel: 'Closed',
    matches: (s) => s === 'matter_closed',
    fg: 'var(--li-muted)',
    bg: 'var(--li-border-soft)',
  },
]
function matterStatusGroup(status: string): (typeof STATUS_GROUPS)[number] {
  return STATUS_GROUPS.find((g) => g.matches(status)) ?? STATUS_GROUPS[0]!
}

function formatDateShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

type SortKey = 'matterNumber' | 'clientName' | 'practiceArea' | 'status' | 'createdAt'

export default function MattersPage() {
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showNew, setShowNew] = useState(false)
  const serviceNames = useServiceDisplayNames()

  const load = useCallback(() => {
    callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' })
      .then((r) => setMatters(r.matters))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Distinct filter options, derived from the loaded matters.
  const statusOptions = useMemo(
    () => Array.from(new Set((matters ?? []).map((m) => m.status).filter(Boolean))).sort(),
    [matters],
  )
  const serviceOptions = useMemo(
    () => Array.from(new Set((matters ?? []).map((m) => m.practiceArea).filter(Boolean))).sort(),
    [matters],
  )
  const clientOptions = useMemo(
    () => Array.from(new Set((matters ?? []).map((m) => m.clientName).filter(Boolean))).sort(),
    [matters],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Dates default newest-first; text columns default A→Z.
      setSortDir(key === 'createdAt' ? 'desc' : 'asc')
    }
  }

  const view = useMemo(() => {
    if (!matters) return null
    const q = query.trim().toLowerCase()
    const rows = matters.filter((m) => {
      if (
        q &&
        ![m.matterNumber, m.clientName, m.practiceArea, m.summary, m.status].some((f) =>
          (f ?? '').toLowerCase().includes(q),
        )
      )
        return false
      if (statusFilter && m.status !== statusFilter) return false
      if (serviceFilter && m.practiceArea !== serviceFilter) return false
      if (clientFilter && m.clientName !== clientFilter) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      }
      return (
        (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, { sensitivity: 'base' }) * dir
      )
    })
  }, [matters, query, statusFilter, serviceFilter, clientFilter, sortKey, sortDir])

  function SortHeader({ label, sortKey: key }: { label: string; sortKey: SortKey }) {
    const active = sortKey === key
    return (
      <button
        type="button"
        className="li-mat-th"
        onClick={() => toggleSort(key)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <ChevronDownIcon
          size={12}
          style={{
            opacity: active ? 1 : 0.35,
            transform: active && sortDir === 'asc' ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>
    )
  }

  const hasFilters = Boolean(query || statusFilter || serviceFilter || clientFilter)

  return (
    <main>
      <div className="li-mat-list-head">
        <h1 className="li-mat-list-title">Matters</h1>
        <button type="button" className="li-mat-list-newbtn" onClick={() => setShowNew(true)}>
          <PlusIcon size={16} />
          New matter
        </button>
      </div>

      {showNew && <NewMatterModal onClose={() => setShowNew(false)} />}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="li-mat-toolbar">
        <div className="li-mat-search">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Search matters"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="li-mat-filter">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">Status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </select>
          <ChevronDownIcon size={14} />
        </label>
        <label className="li-mat-filter">
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            aria-label="Filter by service"
          >
            <option value="">Service</option>
            {serviceOptions.map((s) => (
              <option key={s} value={s}>
                {serviceLabel(s, serviceNames)}
              </option>
            ))}
          </select>
          <ChevronDownIcon size={14} />
        </label>
        <label className="li-mat-filter">
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filter by client"
          >
            <option value="">Client</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <ChevronDownIcon size={14} />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="li-mat-clear"
            onClick={() => {
              setQuery('')
              setStatusFilter('')
              setServiceFilter('')
              setClientFilter('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      {view === null && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}

      {view && view.length === 0 && (
        <div className="li-mat-empty">
          {matters && matters.length === 0 ? 'No matters yet.' : 'No matches.'}
        </div>
      )}

      {view && view.length > 0 && (
        <div className="li-mat-table">
          <div className="li-mat-thead">
            <SortHeader label="Matter" sortKey="matterNumber" />
            <SortHeader label="Client" sortKey="clientName" />
            <SortHeader label="Service" sortKey="practiceArea" />
            <SortHeader label="Status" sortKey="status" />
            <SortHeader label="Opened" sortKey="createdAt" />
          </div>
          <div className="li-mat-tbody">
            {view.map((m) => {
              const group = matterStatusGroup(m.status)
              return (
                <Link
                  key={m.matterEntityId}
                  href={`/attorney/matters/${m.matterEntityId}`}
                  className="li-mat-row"
                >
                  <span className="li-mat-cell-number">
                    {m.matterNumber}
                    {m.summary && <span className="li-mat-cell-summary">{m.summary}</span>}
                  </span>
                  <span className="li-mat-cell-client">{m.clientName || '—'}</span>
                  <span className="li-mat-cell-service">
                    {serviceLabel(m.practiceArea, serviceNames)}
                  </span>
                  <span className="li-mat-status" style={{ background: group.bg, color: group.fg }}>
                    <span className="li-mat-status-dot" style={{ background: group.fg }} />
                    {group.chipLabel}
                  </span>
                  <span className="li-mat-cell-opened">{formatDateShort(m.createdAt)}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </main>
  )
}

interface ServiceOpt {
  serviceKey: string
  displayName: string
  bookable?: boolean
}

// Open a matter by hand (legal.matter.open → intake.submit + matter.open). Most
// matters come from the booking/intake flow; this is the manual path for walk-ins
// and matters started outside the portal. Pick the service, enter the client, and
// the matter + client_contact are created; then we jump into the new matter.
function NewMatterModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [services, setServices] = useState<ServiceOpt[] | null>(null)
  const [serviceKey, setServiceKey] = useState('')
  const [clientFullName, setClientFullName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientCompanyName, setClientCompanyName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ services: ServiceOpt[] }>({ toolName: 'legal.service.list' })
      .then((r) => {
        if (cancelled) return
        // Booking honesty (MACHINE-COMMS-1 WP0): a service with no active workflow
        // definition cannot open matters (matter.open fails loudly) — don't offer it.
        const openable = r.services.filter((s) => s.bookable !== false)
        setServices(openable)
        setServiceKey((cur) => cur || openable[0]?.serviceKey || '')
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const canSubmit = serviceKey !== '' && clientFullName.trim() !== '' && clientEmail.trim() !== ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await callAttorneyMcp<{ matterEntityId: string }>({
        toolName: 'legal.matter.open',
        input: {
          serviceKey,
          clientFullName: clientFullName.trim(),
          clientEmail: clientEmail.trim(),
          clientCompanyName: clientCompanyName.trim() || undefined,
        },
      })
      router.push(`/attorney/matters/${r.matterEntityId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New matter"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-matter-form"
            className="primary"
            disabled={!canSubmit || busy}
          >
            {busy ? 'Creating…' : 'Create matter'}
          </button>
        </>
      }
    >
      <form
        id="new-matter-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
        <label>
          <span>Service</span>
          <select
            value={serviceKey}
            onChange={(e) => setServiceKey(e.target.value)}
            disabled={!services}
          >
            {!services && <option value="">Loading…</option>}
            {services && services.length === 0 && <option value="">No active services</option>}
            {services?.map((s) => (
              <option key={s.serviceKey} value={s.serviceKey}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Client name</span>
          <input
            value={clientFullName}
            onChange={(e) => setClientFullName(e.target.value)}
            placeholder="Jane Doe"
            autoFocus
          />
        </label>
        <label>
          <span>Client email</span>
          <input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="jane@example.com"
          />
        </label>
        <label>
          <span>Company (optional)</span>
          <input
            value={clientCompanyName}
            onChange={(e) => setClientCompanyName(e.target.value)}
            placeholder="Acme LLC"
          />
        </label>
        {err && <div className="alert alert-error">{err}</div>}
      </form>
    </Modal>
  )
}
