'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { ClockIcon } from '@/components/icons'
import { Tabs } from '@/components/Tabs'

interface ClientSummary {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  companyName: string | null
  attributionSource: string | null
  matterCount: number
  firstSeenAt: string
  lastActivityAt: string
}

interface PartnerSummary {
  partnerEntityId: string
  fullName: string
  email: string | null
  phone: string | null
  firm: string | null
  specialty: string | null
  createdAt: string
  updatedAt: string
}

interface AttorneySummary {
  attorneyEntityId: string
  fullName: string
  email: string | null
  phone: string | null
  firm: string | null
  role: string | null
  createdAt: string
  updatedAt: string
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const ms = Date.now() - t
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

export default function ContactsPage() {
  return (
    <main>
      <PageHead
        title="Contacts"
        description="Clients, referral partners, and other attorneys in your network."
      />
      <Tabs
        tabs={[
          { key: 'clients', label: 'Clients', content: <ClientsTab /> },
          {
            key: 'referral-partners',
            label: 'Referral partners',
            content: <ReferralPartnersTab />,
          },
          { key: 'other-attorneys', label: 'Other attorneys', content: <OtherAttorneysTab /> },
        ]}
      />
    </main>
  )
}

// ── Clients ──────────────────────────────────────────────────────────────────

function ClientsTab() {
  const [contacts, setContacts] = useState<ClientSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    callAttorneyMcp<{ contacts: ClientSummary[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(() => {
    if (!contacts) return null
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) =>
      [c.fullName, c.email, c.companyName ?? '', c.phone ?? '', c.attributionSource ?? ''].some(
        (f) => f.toLowerCase().includes(q),
      ),
    )
  }, [contacts, query])

  return (
    <section style={{ padding: 0, overflow: 'hidden' }}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="client-search-row">
        <input
          type="search"
          placeholder="Search clients by name, email, company, phone, source…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {filtered && filtered.length === 0 && (
        <div className="loading-block text-muted">
          {contacts && contacts.length === 0
            ? 'No clients yet — they show up here after booking.'
            : 'No matches.'}
        </div>
      )}
      {filtered && filtered.length > 0 && (
        <table className="client-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Source</th>
              <th>Matters</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.contactEntityId}>
                <td>
                  <Link
                    href={`/attorney/contacts/${c.contactEntityId}`}
                    className="client-name-link"
                  >
                    {c.fullName || '—'}
                  </Link>
                </td>
                <td className="text-muted">{c.companyName ?? '—'}</td>
                <td className="text-muted">{c.email || '—'}</td>
                <td className="text-muted">{c.phone ?? '—'}</td>
                <td className="text-muted">{c.attributionSource ?? '—'}</td>
                <td>{c.matterCount}</td>
                <td className="text-muted">
                  <span className="icon-inline">
                    <ClockIcon size={12} />
                    {timeAgo(c.lastActivityAt)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ── Referral partners ────────────────────────────────────────────────────────

interface PartnerForm {
  fullName: string
  email: string
  phone: string
  firm: string
  specialty: string
  address: string
  referralTerms: string
  notes: string
}

const EMPTY_PARTNER: PartnerForm = {
  fullName: '',
  email: '',
  phone: '',
  firm: '',
  specialty: '',
  address: '',
  referralTerms: '',
  notes: '',
}

function ReferralPartnersTab() {
  const [partners, setPartners] = useState<PartnerSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<PartnerForm>(EMPTY_PARTNER)
  const [busy, setBusy] = useState(false)

  function refresh() {
    callAttorneyMcp<{ partners: PartnerSummary[] }>({ toolName: 'legal.referralPartner.list' })
      .then((r) => setPartners(r.partners))
      .catch((e) => setError(e.message))
  }
  useEffect(refresh, [])

  const filtered = useMemo(() => {
    if (!partners) return null
    const q = query.trim().toLowerCase()
    if (!q) return partners
    return partners.filter((p) =>
      [p.fullName, p.email ?? '', p.firm ?? '', p.specialty ?? ''].some((f) =>
        f.toLowerCase().includes(q),
      ),
    )
  }, [partners, query])

  async function save() {
    if (!form.fullName.trim()) {
      setError('Full name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.referralPartner.create',
        input: {
          fullName: form.fullName.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          firm: form.firm.trim() || null,
          specialty: form.specialty.trim() || null,
          address: form.address.trim() || null,
          referralTerms: form.referralTerms.trim() || null,
          notes: form.notes.trim() || null,
        },
      })
      setForm(EMPTY_PARTNER)
      setShowAdd(false)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ padding: 0, overflow: 'hidden' }}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="client-search-row" style={{ display: 'flex', gap: '0.6rem' }}>
        <input
          type="search"
          placeholder="Search by name, firm, specialty…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={() => setShowAdd(true)}>
          + Add partner
        </button>
      </div>
      {filtered === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {filtered && filtered.length === 0 && (
        <div className="loading-block text-muted">
          {partners && partners.length === 0
            ? 'No referral partners yet. Add one to get started.'
            : 'No matches.'}
        </div>
      )}
      {filtered && filtered.length > 0 && (
        <table className="client-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Firm</th>
              <th>Specialty</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.partnerEntityId}>
                <td>
                  <Link
                    href={`/attorney/contacts/${p.partnerEntityId}`}
                    className="client-name-link"
                  >
                    {p.fullName || '—'}
                  </Link>
                </td>
                <td className="text-muted">{p.firm ?? '—'}</td>
                <td className="text-muted">{p.specialty ?? '—'}</td>
                <td className="text-muted">{p.email ?? '—'}</td>
                <td className="text-muted">{p.phone ?? '—'}</td>
                <td className="text-muted">
                  <span className="icon-inline">
                    <ClockIcon size={12} />
                    {timeAgo(p.updatedAt)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <ContactModal
          title="Add referral partner"
          onClose={() => setShowAdd(false)}
          onSave={save}
          busy={busy}
        >
          <FormGrid>
            <FormField
              label="Full name *"
              value={form.fullName}
              onChange={(v) => setForm({ ...form, fullName: v })}
            />
            <FormField
              label="Firm"
              value={form.firm}
              onChange={(v) => setForm({ ...form, firm: v })}
            />
            <FormField
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <FormField
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <FormField
              label="Specialty"
              value={form.specialty}
              onChange={(v) => setForm({ ...form, specialty: v })}
              placeholder="estate planning, tax, immigration…"
            />
            <FormField
              label="Referral terms"
              value={form.referralTerms}
              onChange={(v) => setForm({ ...form, referralTerms: v })}
              placeholder="reciprocal, none, 15% split…"
            />
          </FormGrid>
          <FormField
            label="Address"
            value={form.address}
            onChange={(v) => setForm({ ...form, address: v })}
            multiline
          />
          <FormField
            label="Notes"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            multiline
          />
        </ContactModal>
      )}
    </section>
  )
}

// ── Other attorneys ──────────────────────────────────────────────────────────

interface AttorneyForm {
  fullName: string
  email: string
  phone: string
  firm: string
  barNumber: string
  barState: string
  role: string
  notes: string
}

const EMPTY_ATTORNEY: AttorneyForm = {
  fullName: '',
  email: '',
  phone: '',
  firm: '',
  barNumber: '',
  barState: '',
  role: '',
  notes: '',
}

function OtherAttorneysTab() {
  const [attorneys, setAttorneys] = useState<AttorneySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AttorneyForm>(EMPTY_ATTORNEY)
  const [busy, setBusy] = useState(false)

  function refresh() {
    callAttorneyMcp<{ attorneys: AttorneySummary[] }>({ toolName: 'legal.otherAttorney.list' })
      .then((r) => setAttorneys(r.attorneys))
      .catch((e) => setError(e.message))
  }
  useEffect(refresh, [])

  const filtered = useMemo(() => {
    if (!attorneys) return null
    const q = query.trim().toLowerCase()
    if (!q) return attorneys
    return attorneys.filter((a) =>
      [a.fullName, a.email ?? '', a.firm ?? '', a.role ?? ''].some((f) =>
        f.toLowerCase().includes(q),
      ),
    )
  }, [attorneys, query])

  async function save() {
    if (!form.fullName.trim()) {
      setError('Full name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.otherAttorney.create',
        input: {
          fullName: form.fullName.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          firm: form.firm.trim() || null,
          barNumber: form.barNumber.trim() || null,
          barState: form.barState.trim() || null,
          role: form.role.trim() || null,
          notes: form.notes.trim() || null,
        },
      })
      setForm(EMPTY_ATTORNEY)
      setShowAdd(false)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ padding: 0, overflow: 'hidden' }}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="client-search-row" style={{ display: 'flex', gap: '0.6rem' }}>
        <input
          type="search"
          placeholder="Search by name, firm, role…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={() => setShowAdd(true)}>
          + Add attorney
        </button>
      </div>
      {filtered === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {filtered && filtered.length === 0 && (
        <div className="loading-block text-muted">
          {attorneys && attorneys.length === 0
            ? 'No other attorneys yet. Add one to get started.'
            : 'No matches.'}
        </div>
      )}
      {filtered && filtered.length > 0 && (
        <table className="client-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Firm</th>
              <th>Role</th>
              <th>Email</th>
              <th>Bar</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.attorneyEntityId}>
                <td>
                  <Link
                    href={`/attorney/contacts/${a.attorneyEntityId}`}
                    className="client-name-link"
                  >
                    {a.fullName || '—'}
                  </Link>
                </td>
                <td className="text-muted">{a.firm ?? '—'}</td>
                <td className="text-muted">{a.role ?? '—'}</td>
                <td className="text-muted">{a.email ?? '—'}</td>
                <td className="text-muted">—</td>
                <td className="text-muted">
                  <span className="icon-inline">
                    <ClockIcon size={12} />
                    {timeAgo(a.updatedAt)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <ContactModal
          title="Add other attorney"
          onClose={() => setShowAdd(false)}
          onSave={save}
          busy={busy}
        >
          <FormGrid>
            <FormField
              label="Full name *"
              value={form.fullName}
              onChange={(v) => setForm({ ...form, fullName: v })}
            />
            <FormField
              label="Firm"
              value={form.firm}
              onChange={(v) => setForm({ ...form, firm: v })}
            />
            <FormField
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <FormField
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <FormField
              label="Bar number"
              value={form.barNumber}
              onChange={(v) => setForm({ ...form, barNumber: v })}
            />
            <FormField
              label="Bar state"
              value={form.barState}
              onChange={(v) => setForm({ ...form, barState: v })}
              placeholder="NC"
            />
          </FormGrid>
          <FormField
            label="Role"
            value={form.role}
            onChange={(v) => setForm({ ...form, role: v })}
            placeholder="co_counsel, opposing_counsel, mentor, network…"
          />
          <FormField
            label="Notes"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            multiline
          />
        </ContactModal>
      )}
    </section>
  )
}

// ── Shared form bits ─────────────────────────────────────────────────────────

function ContactModal({
  title,
  children,
  onClose,
  onSave,
  busy,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  onSave: () => void
  busy: boolean
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="modal-close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="form-grid">{children}</div>
}

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  multiline?: boolean
}) {
  return (
    <label>
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  )
}
