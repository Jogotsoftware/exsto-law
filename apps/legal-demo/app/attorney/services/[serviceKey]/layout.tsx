'use client'

// Service editor shell — one <main>, a persistent header (service name + status),
// and the shared tab bar, wrapping every panel of a service (Settings,
// Questionnaire, Templates, Prompt, Billing). Replaces the old top-right "Edit
// questionnaire / Edit prompt / Edit templates" link soup: the sub-pages are now
// tabs under this layout, so each child renders its panel content only (no own
// <main>, no back-to-service link).
//
// For the create flow (/attorney/services/new) there is no service yet, so this
// shows just a title + the create form (the Settings page in its isNew mode) with
// no tabs — tabs appear once the service exists.
import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ServiceTabs } from '@/components/ServiceTabs'

type GenerationMode = 'template_merge' | 'ai_draft'
interface ServiceHead {
  displayName: string
  generationMode: GenerationMode
  isActive: boolean
}

export default function ServiceEditorLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ serviceKey: string }>()
  const pathname = usePathname()
  const serviceKey = params.serviceKey
  const isNew = serviceKey === 'new'
  const [svc, setSvc] = useState<ServiceHead | null>(null)

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    callAttorneyMcp<{ service: ServiceHead | null }>({
      toolName: 'legal.service.get',
      input: { serviceKey },
    })
      .then((r) => {
        if (!cancelled && r.service) setSvc(r.service)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Re-read on tab navigation so a generation-mode change saved on Settings
    // makes the Prompt tab appear/disappear without a manual reload.
  }, [serviceKey, isNew, pathname])

  if (isNew) {
    return (
      <main>
        <div
          className="attorney-page-head"
          style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
        >
          <h1 style={{ margin: 0 }}>New service</h1>
          <Link href="/attorney/services" className="back-link" style={{ marginLeft: 'auto' }}>
            Back to services
          </Link>
        </div>
        {children}
      </main>
    )
  }

  return (
    <main>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
      >
        <h1 style={{ margin: 0 }}>{svc?.displayName ?? 'Service'}</h1>
        {svc && (
          <span className={`badge ${svc.isActive ? 'ok' : ''}`}>
            {svc.isActive ? 'Enabled' : 'Disabled'}
          </span>
        )}
        <Link href="/attorney/services" className="back-link" style={{ marginLeft: 'auto' }}>
          Back to services
        </Link>
      </div>
      <ServiceTabs
        serviceKey={serviceKey}
        generationMode={svc?.generationMode ?? 'template_merge'}
      />
      {children}
    </main>
  )
}
