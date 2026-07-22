'use client'

// CRM Client detail shell: the persistent chrome (back link, identity header,
// tab bar) that wraps the Overview / Documents / Activity tabs — the same
// "one workspace, tabbed panels" shape the matter editor uses (matters/[id]/
// layout.tsx). The identity header lives here so it stays put across tab
// navigation; each tab page renders only its own body.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { BackButton } from '@/components/BackButton'
import { CrmDetailTabs } from '@/components/CrmDetailTabs'
import { CRM_STATUS_META, crmInitials, type CrmBucket } from '@/lib/crmStatus'

interface ClientIdentity {
  name: string
  crmBucket: CrmBucket
}

export default function ClientDetailLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = use(params)
  const [identity, setIdentity] = useState<ClientIdentity | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ client: { name: string; crmBucket: CrmBucket } | null }>({
      toolName: 'legal.client.get',
      input: { clientEntityId: id },
    })
      .then((r) => {
        if (!cancelled && r.client)
          setIdentity({ name: r.client.name, crmBucket: r.client.crmBucket })
      })
      .catch(() => {
        /* the child page surfaces load errors; the header just stays quiet */
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const statusMeta = identity ? CRM_STATUS_META[identity.crmBucket] : null

  return (
    <>
      <BackButton
        fallback="/attorney/crm"
        className="li-crm-back"
        label="Clients"
        style={{ gap: 6, paddingLeft: 10, marginBottom: 18 }}
      />
      <div className="li-crm-detail-head">
        <span className="li-crm-avatar-tile">{crmInitials(identity?.name || '?')}</span>
        <div className="li-crm-detail-titles">
          <div className="li-crm-detail-name-row">
            <h1>{identity?.name || 'Client'}</h1>
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
      <CrmDetailTabs base={`/attorney/crm/${id}`} />
      {children}
    </>
  )
}
