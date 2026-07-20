'use client'

// Contact detail (CRM). Shows the contact's attributes, standing, referral
// source, and all their matters (clickable through to each). Read-only over the
// existing legal.contact.get query; portal invite is the one write action here.
//
// li-wp-j: restyled to the comp's CRM CONTACT DETAIL (avatar + h1 + status chip,
// Email + Invite-to-portal header actions, kv info card, Portal access card,
// Matters list). The header's "Email" button is new — the comp shows one and
// launchCompose (Contract D, already used identically on the Client detail page)
// is a real, working flow, so it's wired rather than omitted. Invite-to-portal
// was already real (legal.contact.invite_to_portal); kept, restyled, and now
// also mirrored as the header action per the comp (both call the same invite()).

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { BackButton } from '@/components/BackButton'
import { launchCompose } from '@/lib/contractD'
import { MailIcon } from '@/components/icons'
import { CRM_STATUS_META, crmInitials, type CrmBucket } from '@/lib/crmStatus'
import { serviceLabel, useServiceDisplayNames } from '@/lib/serviceLabel'

interface ContactMatter {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  summary: string
  createdAt: string
}

interface ContactDetail {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  companyName: string | null
  attributionSource: string | null
  matterCount: number
  crmBucket: CrmBucket
  firstSeenAt: string
  lastActivityAt: string
  matters: ContactMatter[]
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

// Mirrors the Client detail page's dot coloring (kept as a small local helper —
// each CRM surface owns its own, per the app's established convention).
const MATTER_DOT: Array<{ matches: (s: string) => boolean; color: string }> = [
  { matches: (s) => s === 'matter_closed', color: 'var(--li-muted)' },
  { matches: (s) => s === 'engagement_signed' || s === 'matter_active', color: 'var(--li-ok)' },
  { matches: (s) => s === 'drafting' || s === 'review_pending', color: 'var(--li-warn)' },
  {
    matches: (s) => s === 'consultation_scheduled' || s === 'consultation_completed',
    color: 'var(--li-info)',
  },
]
function matterDotColor(status: string): string {
  return MATTER_DOT.find((g) => g.matches(status))?.color ?? 'var(--li-purple)'
}

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const serviceNames = useServiceDisplayNames()

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ contact: ContactDetail | null }>({
        toolName: 'legal.contact.get',
        input: { contactEntityId: id },
      })
      if (!r.contact) setError('Contact not found.')
      else setContact(r.contact)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const invite = useCallback(async () => {
    setInviting(true)
    setInviteMsg(null)
    try {
      const r = await callAttorneyMcp<{ ok: boolean; email?: string; error?: string }>({
        toolName: 'legal.contact.invite_to_portal',
        input: { contactEntityId: id },
      })
      if (r.ok) {
        setInviteMsg({ ok: true, text: `Invite sent to ${r.email}.` })
      } else {
        setInviteMsg({ ok: false, text: r.error ?? 'Could not send the invite.' })
      }
    } catch (e) {
      setInviteMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setInviting(false)
    }
  }, [id])

  if (error && !contact) {
    return (
      <>
        <BackButton
          fallback="/attorney/crm/contacts"
          className="li-crm-back"
          label="Contacts"
          style={{ gap: 6, paddingLeft: 10, marginBottom: 18 }}
        />
        <div className="alert alert-error">{error}</div>
      </>
    )
  }

  if (!contact) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  const statusMeta = CRM_STATUS_META[contact.crmBucket]

  return (
    <>
      <BackButton fallback="/attorney/crm/contacts" className="li-crm-back" label="Contacts" />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="li-crm-detail-head">
        <span className="li-crm-avatar li-crm-avatar-lg">
          {crmInitials(contact.fullName || contact.email || '?')}
        </span>
        <div className="li-crm-detail-titles">
          <div className="li-crm-detail-name-row">
            <h1>{contact.fullName || contact.email || 'Contact'}</h1>
            <span
              className="li-crm-detail-status"
              style={{ background: statusMeta.bg, color: statusMeta.fg }}
            >
              <span className="li-crm-status-dot" style={{ background: statusMeta.fg }} />
              {statusMeta.label}
            </span>
          </div>
        </div>
        <div className="li-crm-actions">
          <button
            type="button"
            className="li-crm-btn"
            onClick={() => launchCompose({ contactId: contact.contactEntityId, to: contact.email })}
            disabled={!contact.email}
            title={contact.email ? `Email ${contact.email}` : 'No email on file'}
          >
            <MailIcon size={15} />
            Email
          </button>
          <button
            type="button"
            className="li-crm-btn-primary"
            disabled={inviting || !contact.email}
            onClick={invite}
          >
            {inviting ? 'Sending…' : 'Invite to portal'}
          </button>
        </div>
      </div>

      <div className="li-crm-kv-card">
        <div className="li-crm-kv-grid">
          <div>
            <div className="li-crm-kv-label">Email</div>
            <div className="li-crm-kv-value">{contact.email || '—'}</div>
          </div>
          <div>
            <div className="li-crm-kv-label">Phone</div>
            <div className="li-crm-kv-value">{contact.phone || '—'}</div>
          </div>
          <div>
            <div className="li-crm-kv-label">Company</div>
            <div className="li-crm-kv-value">{contact.companyName || '—'}</div>
          </div>
          <div>
            <div className="li-crm-kv-label">Referral source</div>
            <div className="li-crm-kv-value">{contact.attributionSource || '—'}</div>
          </div>
        </div>
      </div>

      <div className="li-crm-portal-card">
        <h2 className="li-crm-panel-title">Portal access</h2>
        <p className="li-crm-portal-desc">
          Email this client a secure link to set a password and sign in to view their matters,
          documents, and invoices, and message you. Re-sending resets their password.
        </p>
        <button
          type="button"
          className="li-crm-btn-primary"
          disabled={inviting || !contact.email}
          onClick={invite}
        >
          {inviting ? 'Sending…' : 'Invite to portal'}
        </button>
        {!contact.email && <span className="li-crm-portal-hint">Add an email first.</span>}
        {inviteMsg && (
          <div className={`alert ${inviteMsg.ok ? 'alert-success' : 'alert-error'}`}>
            {inviteMsg.text}
          </div>
        )}
      </div>

      <div className="li-crm-panel">
        <div className="li-crm-panel-head">
          <h2 className="li-crm-panel-title">
            Matters <span className="li-crm-panel-count">{contact.matterCount}</span>
          </h2>
        </div>
        {contact.matters.length === 0 ? (
          <div className="li-crm-panel-empty">No matters yet.</div>
        ) : (
          contact.matters.map((m) => (
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
                  {m.serviceKey ? serviceLabel(m.serviceKey, serviceNames) : m.matterNumber}
                </span>
                <span className="li-crm-contact-sub">
                  {humanizeStatus(m.status)}
                  {m.summary && ` · ${m.summary}`}
                </span>
              </span>
              <span className="li-crm-matter-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  )
}
