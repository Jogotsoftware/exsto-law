'use client'

// CRM Contact detail shell: back link + identity header + Overview/Documents/
// Activity tabs, wrapping every contact tab (mirrors the client detail shell and
// the matter workspace). The header persists across tabs; each tab page renders
// only its body.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { BackButton } from '@/components/BackButton'
import { CrmDetailTabs } from '@/components/CrmDetailTabs'
import { CRM_STATUS_META, crmInitials, type CrmBucket } from '@/lib/crmStatus'

interface ContactIdentity {
  name: string
  crmBucket: CrmBucket
}

export default function ContactDetailLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = use(params)
  const [identity, setIdentity] = useState<ContactIdentity | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{
      contact: { fullName: string; email: string; crmBucket: CrmBucket } | null
    }>({
      toolName: 'legal.contact.get',
      input: { contactEntityId: id },
    })
      .then((r) => {
        if (!cancelled && r.contact)
          setIdentity({
            name: r.contact.fullName || r.contact.email,
            crmBucket: r.contact.crmBucket,
          })
      })
      .catch(() => {
        /* the child page surfaces load errors; the header stays quiet */
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const statusMeta = identity ? CRM_STATUS_META[identity.crmBucket] : null

  return (
    <>
      <BackButton fallback="/attorney/crm/contacts" className="li-crm-back" label="Contacts" />
      <div className="li-crm-detail-head">
        <span className="li-crm-avatar li-crm-avatar-lg">{crmInitials(identity?.name || '?')}</span>
        <div className="li-crm-detail-titles">
          <div className="li-crm-detail-name-row">
            <h1>{identity?.name || 'Contact'}</h1>
            {statusMeta && (
              <span
                className="li-crm-detail-status"
                style={{ background: statusMeta.bg, color: statusMeta.fg }}
              >
                <span className="li-crm-status-dot" style={{ background: statusMeta.fg }} />
                {statusMeta.label}
              </span>
            )}
          </div>
        </div>
      </div>
      <CrmDetailTabs base={`/attorney/crm/contacts/${id}`} />
      {children}
    </>
  )
}
