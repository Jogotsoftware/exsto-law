'use client'

// CRM › Client page. A client is the parent that groups its contacts and
// matters (migration 0020). Shows both, each clickable through, plus Contract-D
// Email / Schedule launchers aimed at the client's main contact. Lives under the
// CRM layout (Clients · Contacts tabs); contacts link into the Contacts tab.
//
// li-wp-j: restyled to the comp's CRM CLIENT DETAIL (avatar tile + h1 + status
// chip, Email/Schedule/Edit actions, 4 stat cards, Contacts + Matters panels).
// All three action buttons were VERIFIED to already have a real backing flow
// (launchCompose, launchScheduler, the existing inline edit form via
// legal.client.update) — none omitted. NotesSection isn't in the comp's CRM
// screens at all, but it's real, working, substrate-backed capability (not a
// stub) — kept per the WP-C precedent ("AI review kept... real, pre-existing
// capability the comp doesn't show"), just housed in its own panel here rather
// than dropped.
//
// WP B3 (founder-approved, comp parity): the client's website is now real
// (client_website attribute, migration 0172 — PLANNED, not yet applied). The
// comp computes a `crmWebsite` value for this screen but never renders it
// anywhere in the CRM CLIENT DETAIL markup (dead in the comp itself) — so this
// adds a website subtitle line under the name (when set, a clickable external
// link) plus an editable field in the edit card, in the comp's visual idiom
// rather than a literal comp element. The Billing stat card is UNCHANGED here
// (only the CRM LIST's column swapped to Website — see crm/page.tsx).

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { BackButton } from '@/components/BackButton'
import { NotesSection } from '@/components/NotesSection'
import { BriefButton } from '@/components/BriefButton'
import { launchCompose, launchScheduler } from '@/lib/contractD'
import { MailIcon, CalendarIcon, EditIcon, GlobeIcon } from '@/components/icons'
import { CRM_STATUS_META, crmInitials, formatCrmDate, type CrmBucket } from '@/lib/crmStatus'

type BillingType = '' | 'hourly' | 'fixed'
const MONEY_RE = /^\d+(\.\d{1,2})?$/

interface ClientContactRow {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  isMain: boolean
}
interface ClientMatterRow {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  createdAt: string
}
interface ClientDetail {
  clientEntityId: string
  name: string
  billableRate: string | null
  billingType: string | null
  website: string | null
  portalSchedulingBillable?: boolean
  mainContactId: string | null
  mainContactName: string | null
  contactCount: number
  matterCount: number
  crmBucket: CrmBucket
  lastActivityAt: string
  createdAt: string
  contacts: ClientContactRow[]
  matters: ClientMatterRow[]
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

function billingLabel(c: ClientDetail): string {
  if (!c.billingType) return 'Not set'
  const rate = c.billableRate ? ` · $${c.billableRate}` : ''
  return c.billingType === 'hourly' ? `Hourly${rate}` : `Fixed${rate}`
}

// WP B3: the stored value is free text (attorney-entered, no format enforced
// by the handler) — add a scheme only for the href so a bare domain like
// "acme.com" still opens correctly; the visible label stays exactly as typed.
function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

// Same 5-way dot as the matter list/detail (li-mat-status), read here to color
// the Matters panel's status dot consistently with the rest of the app.
const MATTER_DOT: Array<{ matches: (s: string) => boolean; color: string }> = [
  { matches: (s) => s === 'matter_closed', color: 'var(--li-muted)' },
  {
    matches: (s) => s === 'engagement_signed' || s === 'matter_active',
    color: 'var(--li-ok)',
  },
  {
    matches: (s) => s === 'drafting' || s === 'review_pending',
    color: 'var(--li-warn)',
  },
  {
    matches: (s) => s === 'consultation_scheduled' || s === 'consultation_completed',
    color: 'var(--li-info)',
  },
]
function matterDotColor(status: string): string {
  // Default bucket is "New inquiry" (matches attorney/matters/page.tsx STATUS_GROUPS),
  // which reads as a neutral gray, not the purple reserved for in-review statuses.
  return MATTER_DOT.find((g) => g.matches(status))?.color ?? 'var(--li-neutral)'
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{
    name: string
    billingType: BillingType
    rate: string
    website: string
    mainContactId: string
    portalSchedulingBillable: boolean
  }>({
    name: '',
    billingType: '',
    rate: '',
    website: '',
    mainContactId: '',
    portalSchedulingBillable: false,
  })

  const load = useCallback(() => {
    callAttorneyMcp<{ client: ClientDetail | null }>({
      toolName: 'legal.client.get',
      input: { clientEntityId: id },
    })
      .then((r) => (r.client ? setClient(r.client) : setNotFound(true)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  useEffect(load, [load])

  const mainContact = client?.contacts.find((c) => c.isMain) ?? client?.contacts[0] ?? null

  function beginEdit() {
    if (!client) return
    setForm({
      name: client.name ?? '',
      billingType: (client.billingType as BillingType) ?? '',
      rate: client.billableRate ?? '',
      website: client.website ?? '',
      mainContactId: client.mainContactId ?? '',
      portalSchedulingBillable: Boolean(client.portalSchedulingBillable),
    })
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (!client) return
    if (!form.name.trim()) {
      setError('A client name is required.')
      return
    }
    if (form.billingType !== '' && form.rate.trim() && !MONEY_RE.test(form.rate.trim())) {
      setError('Enter the rate as an amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = {
        client_entity_id: client.clientEntityId,
        client_name: form.name.trim(),
      }
      if (form.billingType !== '') {
        input.billing_type = form.billingType
        if (form.rate.trim()) input.billable_rate = form.rate.trim()
      }
      if (form.mainContactId) input.main_contact_id = form.mainContactId
      input.portal_scheduling_billable = form.portalSchedulingBillable
      // Always sent (even blank): the update handler's resolveWebsiteOp treats
      // an explicit blank as a clear, mirroring billable_rate/billing_type.
      input.website = form.website.trim()
      await callAttorneyMcp({ toolName: 'legal.client.update', input })
      setEditing(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <>
        <BackButton
          fallback="/attorney/crm"
          className="li-crm-back"
          label="Clients"
          style={{ gap: 6, paddingLeft: 10, marginBottom: 18 }}
        />
        <p className="text-muted">Client not found.</p>
      </>
    )
  }

  if (!client) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  const statusMeta = CRM_STATUS_META[client.crmBucket]

  return (
    <>
      <BackButton
        fallback="/attorney/crm"
        className="li-crm-back"
        label="Clients"
        style={{ gap: 6, paddingLeft: 10, marginBottom: 18 }}
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="li-crm-detail-head">
        <span className="li-crm-avatar-tile">{crmInitials(client.name || '?')}</span>
        <div className="li-crm-detail-titles">
          <div className="li-crm-detail-name-row">
            <h1>{client.name || 'Client'}</h1>
            <span
              className="li-crm-detail-status"
              style={{ background: statusMeta.bg, color: statusMeta.fg }}
            >
              <span className="li-crm-status-dot" style={{ background: statusMeta.fg }} />
              {statusMeta.label}
            </span>
          </div>
          {client.website && (
            <a
              className="li-crm-detail-website"
              href={websiteHref(client.website)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GlobeIcon size={13} />
              {client.website}
            </a>
          )}
        </div>
        <div className="li-crm-actions">
          {/* Brief engine WP3: the Client Brief door — same shared modal WP2
              uses on the matter header, get-on-open + explicit generate/refresh
              only (never automatic). */}
          <BriefButton scope={{ kind: 'client', clientEntityId: id }} className="li-crm-btn" />
          <button
            type="button"
            className="li-crm-btn"
            onClick={() =>
              launchCompose({ contactId: mainContact?.contactEntityId, to: mainContact?.email })
            }
            disabled={!mainContact?.email}
            title={mainContact?.email ? `Email ${mainContact.email}` : 'No contact email on file'}
          >
            <MailIcon size={15} />
            Email
          </button>
          <button
            type="button"
            className="li-crm-btn"
            onClick={() => launchScheduler({ contactId: mainContact?.contactEntityId })}
            title="Schedule a meeting"
          >
            <CalendarIcon size={15} />
            Schedule
          </button>
          <button type="button" className="li-crm-btn-primary" onClick={beginEdit}>
            <EditIcon size={15} />
            Edit
          </button>
        </div>
      </div>

      {editing && (
        <section className="li-crm-editcard">
          <h2>Edit client</h2>
          <div className="form-grid">
            <label>
              <span>Client name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              <span>Billing</span>
              <select
                value={form.billingType}
                onChange={(e) => setForm({ ...form, billingType: e.target.value as BillingType })}
              >
                <option value="">Not set</option>
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
            {form.billingType !== '' && (
              <label>
                <span>{form.billingType === 'hourly' ? 'Hourly rate (USD)' : 'Fee (USD)'}</span>
                <input
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="350.00"
                />
              </label>
            )}
            <label>
              <span>Website</span>
              <input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="acme.com"
              />
            </label>
            <label className="form-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.portalSchedulingBillable}
                onChange={(e) => setForm({ ...form, portalSchedulingBillable: e.target.checked })}
              />
              <span>
                Portal scheduling is billable (client accepts rate × duration before booking)
              </span>
            </label>
            {client.contacts.length > 0 && (
              <label>
                <span>Main contact</span>
                <select
                  value={form.mainContactId}
                  onChange={(e) => setForm({ ...form, mainContactId: e.target.value })}
                >
                  <option value="">—</option>
                  {client.contacts.map((c) => (
                    <option key={c.contactEntityId} value={c.contactEntityId}>
                      {c.fullName || c.email || '(no name)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
            <button className="primary" onClick={save} disabled={busy || !form.name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="li-crm-stats">
        <div className="li-crm-stat-card">
          <div className="li-crm-stat-label">Billing</div>
          <div className="li-crm-stat-value">{billingLabel(client)}</div>
        </div>
        <div className="li-crm-stat-card">
          <div className="li-crm-stat-label">Contacts</div>
          <div className="li-crm-stat-value">{client.contactCount}</div>
        </div>
        <div className="li-crm-stat-card">
          <div className="li-crm-stat-label">Matters</div>
          <div className="li-crm-stat-value">{client.matterCount}</div>
        </div>
        <div className="li-crm-stat-card">
          <div className="li-crm-stat-label">Client since</div>
          <div className="li-crm-stat-value">{formatCrmDate(client.createdAt)}</div>
        </div>
      </div>

      <div className="li-crm-panels">
        <div className="li-crm-panel">
          <div className="li-crm-panel-head">
            <h2 className="li-crm-panel-title">Contacts</h2>
          </div>
          {client.contacts.length === 0 ? (
            <div className="li-crm-panel-empty">No contacts attached.</div>
          ) : (
            client.contacts.map((c) => (
              <Link
                key={c.contactEntityId}
                href={`/attorney/crm/contacts/${c.contactEntityId}`}
                className="li-crm-contact-row"
              >
                <span className="li-crm-avatar">{crmInitials(c.fullName || c.email || '?')}</span>
                <span className="li-crm-contact-info">
                  <span className="li-crm-contact-name">
                    {c.fullName || c.email || '(no name)'}
                    {c.isMain && <span className="li-crm-main-badge">Main</span>}
                  </span>
                  <span className="li-crm-contact-sub">
                    {c.email}
                    {c.phone && ` · ${c.phone}`}
                  </span>
                </span>
              </Link>
            ))
          )}
        </div>

        <div className="li-crm-panel">
          <div className="li-crm-panel-head">
            <h2 className="li-crm-panel-title">Matters</h2>
          </div>
          {client.matters.length === 0 ? (
            <div className="li-crm-panel-empty">No matters yet.</div>
          ) : (
            client.matters.map((m) => (
              <Link
                key={m.matterEntityId}
                href={`/attorney/matters/${m.matterEntityId}`}
                className="li-crm-matter-row"
              >
                <span
                  className="li-crm-matter-dot"
                  style={{ background: matterDotColor(m.status) }}
                />
                <span className="li-crm-contact-info">
                  <span className="li-crm-contact-name">
                    {m.serviceKey ? m.serviceKey.replace(/_/g, ' ') : m.matterNumber}
                  </span>
                  <span className="li-crm-contact-sub">
                    {m.matterNumber} · {humanizeStatus(m.status)}
                  </span>
                </span>
                <span className="li-crm-matter-chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="li-crm-panel li-crm-notes-panel">
        <div className="li-crm-panel-head">
          <h2 className="li-crm-panel-title">Notes</h2>
        </div>
        <div className="li-crm-notes-body">
          <NotesSection targetEntityId={id} createInput={{ clientEntityId: id }} />
        </div>
      </div>
    </>
  )
}
