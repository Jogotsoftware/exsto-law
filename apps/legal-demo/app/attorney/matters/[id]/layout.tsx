'use client'

// Matter workspace shell — one <main>, a persistent header (matter number +
// summary + status + Email/Schedule + back link) and the tab bar, wrapping every
// matter panel (Overview / Activity / Documents / Billing). Replaces the old
// single long-scroll page; each child renders its panel content only. The matter's
// AI assistant is no longer embedded here — the global assistant (bottom-right)
// picks up this matter as its context automatically.
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { MatterTabs } from '@/components/MatterTabs'
import { ChevronLeftIcon } from '@/components/icons'
import { launchCompose, launchScheduler } from '@/lib/contractD'
import { humanizeStatus, statusBadgeClass, type MatterDetail } from './shared'

export default function MatterLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [matter, setMatter] = useState<Pick<
    MatterDetail,
    'matterNumber' | 'summary' | 'status' | 'clientEmail' | 'matterEntityId'
  > | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ matter: MatterDetail | null }>({
      toolName: 'legal.matter.get',
      input: { matterEntityId: id },
    })
      .then((r) => {
        if (!cancelled && r.matter) setMatter(r.matter)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <main>
      <Link href="/attorney/matters" className="back-link">
        <ChevronLeftIcon size={14} /> All matters
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <PageHead
          title={matter?.matterNumber ?? 'Matter'}
          description={matter?.summary || undefined}
        />
        {matter && (
          <span className={statusBadgeClass(matter.status)} style={{ marginBottom: '0.4rem' }}>
            {humanizeStatus(matter.status)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          <button
            onClick={() => launchCompose({ matterId: id, to: matter?.clientEmail ?? undefined })}
            title={matter?.clientEmail ? `Email ${matter.clientEmail}` : 'Compose an email'}
          >
            Email
          </button>
          <button onClick={() => launchScheduler({ matterId: id })} title="Schedule a meeting">
            Schedule
          </button>
        </div>
      </div>

      <MatterTabs matterEntityId={id} />
      {children}
    </main>
  )
}
