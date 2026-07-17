'use client'

// Matter workspace shell — one <main>, a persistent header (matter number +
// summary + status + an Actions menu + back link) and the tab bar, wrapping every
// matter panel (Overview / Activity / Documents / Billing). Replaces the old
// single long-scroll page; each child renders its panel content only. The matter's
// AI assistant is no longer embedded here — the global assistant (bottom-right)
// picks up this matter as its context automatically.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { MatterTabs } from '@/components/MatterTabs'
import { ActionsMenu } from '@/components/ActionsMenu'
import { BackButton } from '@/components/BackButton'
import {
  MailIcon,
  CalendarIcon,
  ClockIcon,
  DollarSignIcon,
  ListIcon,
  CheckCircleIcon,
  ChevronDownIcon,
} from '@/components/icons'
import { launchCompose, launchScheduler } from '@/lib/contractD'
import { humanizeService, type MatterDetail } from './shared'

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
    | 'matterNumber'
    | 'summary'
    | 'status'
    | 'clientEmail'
    | 'clientName'
    | 'practiceArea'
    | 'matterEntityId'
    | 'workflow'
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

  // "Close matter" only exists as a real control when this matter's workflow has
  // an authored terminal complete_matter stage to route to (WP-B: "wire to
  // whatever exists" — no dead control for matters without one, e.g. legacy
  // matters with no workflow instance).
  const closeMatterStageKey =
    matter?.workflow?.graph.find((s) => s.action?.kind === 'complete_matter')?.key ?? null

  return (
    <main>
      <BackButton
        fallback="/attorney/matters"
        className="li-mat-back"
        style={{ gap: 6, paddingLeft: 10, marginBottom: 16 }}
      />
      <div className="li-mat-detail-head">
        <div className="li-mat-detail-titles">
          <h1>
            {matter?.clientName || 'Matter'}
            {matter && (
              <>
                <span className="li-mat-detail-dash"> — </span>
                {matter.matterNumber}
              </>
            )}
          </h1>
          {matter?.practiceArea && (
            <div className="li-mat-detail-service">{humanizeService(matter.practiceArea)}</div>
          )}
        </div>
        <ActionsMenu
          triggerClassName="li-mat-actionsbtn"
          triggerContent={
            <>
              Actions
              <ChevronDownIcon size={15} />
            </>
          }
          items={[
            {
              label: 'New task',
              icon: <ListIcon size={16} />,
              href: `/attorney/matters/${id}/tasks?new=1`,
              title: 'Add a task to this matter',
            },
            {
              label: 'Draft email',
              icon: <MailIcon size={16} />,
              onClick: () => launchCompose({ matterId: id, to: matter?.clientEmail ?? undefined }),
              title: matter?.clientEmail ? `Email ${matter.clientEmail}` : 'Compose an email',
            },
            {
              label: 'Schedule',
              icon: <CalendarIcon size={16} />,
              onClick: () => launchScheduler({ matterId: id }),
              title: 'Schedule a meeting',
            },
            {
              label: 'Add time',
              icon: <ClockIcon size={16} />,
              href: `/attorney/matters/${id}/billing?add=time`,
              title: 'Log time on this matter',
            },
            {
              label: 'Add expense',
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
            ...(closeMatterStageKey
              ? [
                  {
                    label: 'Close matter',
                    icon: <CheckCircleIcon size={16} />,
                    href: `/attorney/matters/${id}?closeMatter=1`,
                    title: 'Complete and close this matter',
                    danger: true,
                  },
                ]
              : []),
          ]}
        />
      </div>

      <MatterTabs matterEntityId={id} />
      {children}
    </main>
  )
}
