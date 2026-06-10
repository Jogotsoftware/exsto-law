'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'

type ContactKind = 'client_contact' | 'referral_partner' | 'other_attorney'

interface ContactMatter {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  summary: string
  createdAt: string
}

interface ClientContactDetail {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  companyName: string | null
  attributionSource: string | null
  matterCount: number
  firstSeenAt: string
  lastActivityAt: string
  matters: ContactMatter[]
}

interface ReferralPartnerDetail {
  partnerEntityId: string
  fullName: string
  email: string | null
  phone: string | null
  firm: string | null
  address: string | null
  specialty: string | null
  referralTerms: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface OtherAttorneyDetail {
  attorneyEntityId: string
  fullName: string
  email: string | null
  phone: string | null
  firm: string | null
  barNumber: string | null
  barState: string | null
  role: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

function humanizeService(key: string): string {
  if (!key) return '—'
  if (key === 'llc_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'business_formation') return 'NC LLC formation'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>()
  const [kind, setKind] = useState<ContactKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [client, setClient] = useState<ClientContactDetail | null>(null)
  const [partner, setPartner] = useState<ReferralPartnerDetail | null>(null)
  const [attorney, setAttorney] = useState<OtherAttorneyDetail | null>(null)

  useEffect(() => {
    if (!params?.id) return
    callAttorneyMcp<{ kind: ContactKind | null }>({
      toolName: 'legal.contact.lookup',
      input: { entityId: params.id },
    })
      .then((r) => {
        if (!r.kind) {
          setNotFound(true)
          return
        }
        setKind(r.kind)
        if (r.kind === 'client_contact') {
          return callAttorneyMcp<{ contact: ClientContactDetail | null }>({
            toolName: 'legal.contact.get',
            input: { contactEntityId: params.id },
          }).then((res) => setClient(res.contact))
        }
        if (r.kind === 'referral_partner') {
          return callAttorneyMcp<{ partner: ReferralPartnerDetail | null }>({
            toolName: 'legal.referralPartner.get',
            input: { entityId: params.id },
          }).then((res) => setPartner(res.partner))
        }
        if (r.kind === 'other_attorney') {
          return callAttorneyMcp<{ attorney: OtherAttorneyDetail | null }>({
            toolName: 'legal.otherAttorney.get',
            input: { entityId: params.id },
          }).then((res) => setAttorney(res.attorney))
        }
        return undefined
      })
      .catch((e) => setError(e.message))
  }, [params?.id])

  if (error) {
    return (
      <main>
        <BackLink />
        <div className="alert alert-error">{error}</div>
      </main>
    )
  }
  if (notFound) {
    return (
      <main>
        <BackLink />
        <div className="alert alert-error">Contact not found.</div>
      </main>
    )
  }
  if (!kind) {
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )
  }

  if (kind === 'client_contact') {
    if (!client)
      return (
        <main>
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        </main>
      )
    return (
      <main>
        <BackLink />
        <PageHead title={client.fullName || '—'} description={client.companyName ?? undefined} />
        <section>
          <h2>Client</h2>
          <KvGrid>
            <Kv label="Email" value={client.email || '—'} />
            <Kv label="Phone" value={client.phone || '—'} />
            <Kv label="Company" value={client.companyName || '—'} />
            <Kv label="Source" value={client.attributionSource || '—'} />
          </KvGrid>
        </section>
        <section>
          <h2>Matters ({client.matters.length})</h2>
          {client.matters.length === 0 ? (
            <p className="text-muted">No matters yet.</p>
          ) : (
            <div className="matter-list">
              {client.matters.map((m) => (
                <Link
                  key={m.matterEntityId}
                  href={`/attorney/matters/${m.matterEntityId}`}
                  className="matter-row"
                >
                  <div>
                    <div className="matter-row-title">{humanizeService(m.serviceKey)}</div>
                    <div className="matter-row-sub">
                      {m.matterNumber} · {humanizeStatus(m.status)}
                    </div>
                  </div>
                  <ChevronRightIcon size={16} className="matter-row-chevron" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    )
  }

  if (kind === 'referral_partner') {
    if (!partner)
      return (
        <main>
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        </main>
      )
    return (
      <main>
        <BackLink />
        <PageHead
          title={partner.fullName || '—'}
          description={partner.firm ?? partner.specialty ?? undefined}
        />
        <section>
          <h2>Referral partner</h2>
          <KvGrid>
            <Kv label="Firm" value={partner.firm || '—'} />
            <Kv label="Specialty" value={partner.specialty || '—'} />
            <Kv label="Email" value={partner.email || '—'} />
            <Kv label="Phone" value={partner.phone || '—'} />
            <Kv label="Address" value={partner.address || '—'} wide />
            <Kv label="Referral terms" value={partner.referralTerms || '—'} wide />
            <Kv label="Notes" value={partner.notes || '—'} wide />
          </KvGrid>
        </section>
      </main>
    )
  }

  if (!attorney)
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )
  return (
    <main>
      <BackLink />
      <PageHead
        title={attorney.fullName || '—'}
        description={attorney.firm ?? attorney.role ?? undefined}
      />
      <section>
        <h2>Other attorney</h2>
        <KvGrid>
          <Kv label="Firm" value={attorney.firm || '—'} />
          <Kv label="Role" value={attorney.role || '—'} />
          <Kv label="Email" value={attorney.email || '—'} />
          <Kv label="Phone" value={attorney.phone || '—'} />
          <Kv label="Bar #" value={attorney.barNumber || '—'} />
          <Kv label="Bar state" value={attorney.barState || '—'} />
          <Kv label="Notes" value={attorney.notes || '—'} wide />
        </KvGrid>
      </section>
    </main>
  )
}

function BackLink() {
  return (
    <Link href="/attorney/contacts" className="back-link">
      <ChevronLeftIcon size={14} /> All contacts
    </Link>
  )
}

function KvGrid({ children }: { children: React.ReactNode }) {
  return <div className="kv-grid">{children}</div>
}

function Kv({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div className="kv-label">{label}</div>
      <div className="kv-value" style={{ whiteSpace: 'pre-wrap' }}>
        {value}
      </div>
    </div>
  )
}
