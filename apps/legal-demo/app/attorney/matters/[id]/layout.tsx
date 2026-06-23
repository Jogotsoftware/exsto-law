'use client'

// Matter workspace shell — one <main>, a persistent header (matter number +
// summary + status + an Actions menu + back link) and the tab bar, wrapping every
// matter panel (Overview / Activity / Documents / Billing). Replaces the old
// single long-scroll page; each child renders its panel content only. The matter's
// AI assistant is no longer embedded here — the global assistant (bottom-right)
// picks up this matter as its context automatically.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { MatterTabs } from '@/components/MatterTabs'
import { ActionsMenu } from '@/components/ActionsMenu'
import { BackButton } from '@/components/BackButton'
import { MailIcon, CalendarIcon, ClockIcon, DollarSignIcon } from '@/components/icons'
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
      <BackButton fallback="/attorney/matters" />
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
          <ActionsMenu
            items={[
              {
                label: 'Email',
                icon: <MailIcon size={16} />,
                onClick: () =>
                  launchCompose({ matterId: id, to: matter?.clientEmail ?? undefined }),
                title: matter?.clientEmail ? `Email ${matter.clientEmail}` : 'Compose an email',
              },
              {
                label: 'Schedule',
                icon: <CalendarIcon size={16} />,
                onClick: () => launchScheduler({ matterId: id }),
                title: 'Schedule a meeting',
              },
              {
                label: 'Log time',
                icon: <ClockIcon size={16} />,
                href: `/attorney/matters/${id}/billing?add=time`,
                title: 'Log time on this matter',
              },
              {
                label: 'Log expense',
                icon: <DollarSignIcon size={16} />,
                href: `/attorney/matters/${id}/billing?add=expense`,
                title: 'Log an expense on this matter',
              },
              {
                label: 'Add fee',
                icon: <DollarSignIcon size={16} />,
                href: `/attorney/matters/${id}/billing?add=fee`,
                title: 'Add a service or document fee to this matter',
              },
            ]}
          />
        </div>
      </div>

      <MatterTabs matterEntityId={id} />
      {children}
    </main>
  )
}
