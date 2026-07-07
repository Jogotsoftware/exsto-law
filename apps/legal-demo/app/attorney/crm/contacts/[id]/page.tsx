'use client'

// Contact detail (CRM). Shows the contact's attributes, standing, referral
// source, and all their matters (clickable through to each). Read-only over the
// existing legal.contact.get query.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { BackButton } from '@/components/BackButton'
import { PageHead } from '@/components/PageHead'

type CrmBucket = 'active' | 'prospective' | 'prior'

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

const BUCKET_META: Record<CrmBucket, { label: string; color: string }> = {
  active: { label: 'Active', color: '#16a34a' },
  prospective: { label: 'Prospective', color: '#3b82f6' },
  prior: { label: 'Prior', color: '#6b7280' },
}

function humanizeService(key: string): string {
  if (!key) return ''
  if (key === 'llc_formation' || key === 'business_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)

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

  const standing = contact ? BUCKET_META[contact.crmBucket] : null

  return (
    <main>
      <BackButton fallback="/attorney/crm/contacts" />
      <PageHead
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {contact?.fullName || contact?.email || 'Contact'}
            {standing && (
              <span
                className="badge"
                style={{
                  background: standing.color,
                  color: 'var(--surface)',
                  borderColor: standing.color,
                }}
              >
                {standing.label}
              </span>
            )}
          </span>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}

      {!contact && !error ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : contact ? (
        <>
          <section>
            <div className="form-grid">
              <Field label="Email" value={contact.email || '—'} />
              <Field label="Phone" value={contact.phone || '—'} />
              <Field label="Company" value={contact.companyName || '—'} />
              <Field label="Referral source" value={contact.attributionSource || '—'} />
            </div>
          </section>

          <section>
            <h2 style={{ marginBottom: 'var(--space-2)' }}>Portal access</h2>
            <p className="text-muted" style={{ marginTop: 0 }}>
              Email this client a secure link to set their password and sign in to view their
              matters, documents, and invoices, and message you. Re-sending resets their password.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={inviting || !contact.email}
              onClick={invite}
            >
              {inviting ? 'Sending…' : 'Invite to portal'}
            </button>
            {!contact.email && (
              <span className="text-muted" style={{ marginLeft: 'var(--space-2)' }}>
                Add an email first.
              </span>
            )}
            {inviteMsg && (
              <div
                className={`alert ${inviteMsg.ok ? 'alert-success' : 'alert-error'}`}
                style={{ marginTop: 'var(--space-2)' }}
              >
                {inviteMsg.text}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ marginBottom: 'var(--space-2)' }}>
              Matters{' '}
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{contact.matterCount}</span>
            </h2>
            {contact.matters.length === 0 ? (
              <p className="text-muted">No matters yet.</p>
            ) : (
              <div className="matter-list">
                {contact.matters.map((m) => (
                  <Link
                    key={m.matterEntityId}
                    href={`/attorney/matters/${m.matterEntityId}`}
                    className="matter-row"
                  >
                    <div>
                      <div className="matter-row-title">
                        {humanizeService(m.serviceKey) || m.matterNumber}
                      </div>
                      <div className="matter-row-sub">
                        {humanizeStatus(m.status)}
                        {m.summary && ` · ${m.summary}`}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span>{label}</span>
      <div style={{ padding: 'var(--space-2) 0', fontWeight: 500 }}>{value}</div>
    </label>
  )
}
