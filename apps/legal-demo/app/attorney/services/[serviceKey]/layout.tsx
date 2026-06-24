'use client'

// Service editor shell — one <main>, a persistent header (service name + status),
// and the shared tab bar (ServiceTabs) wrapping every panel of a service
// (Settings · Questionnaire · Templates · [Prompt, AI-draft only] · Workflow ·
// Billing). The tabs are ALWAYS shown so the attorney can move freely between
// panels whether or not the service is enabled yet — there is no separate setup
// stepper that hides them (removed per beta feedback: the setup checklist was
// redundant and made the tabs disappear mid-setup). Enablement readiness lives on
// the Settings panel. The create flow (/attorney/services/new) has no service yet,
// so it shows just the create form.
import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ServiceTabs } from '@/components/ServiceTabs'
import { BackButton } from '@/components/BackButton'

type GenerationMode = 'template_merge' | 'ai_draft'
interface ServiceHead {
  displayName: string
  route: 'auto' | 'manual'
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
    // Re-read on tab navigation so a generation-mode change (which adds/removes the
    // Prompt tab) or an enable/disable updates the header + tabs without a reload.
    callAttorneyMcp<{ service: ServiceHead | null }>({
      toolName: 'legal.service.get',
      input: { serviceKey },
    })
      .then((s) => {
        if (!cancelled && s.service) setSvc(s.service)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [serviceKey, isNew, pathname])

  if (isNew) {
    return (
      <main>
        <BackButton fallback="/attorney/services" forceFallback />
        <div
          className="attorney-page-head"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
        >
          <h1 style={{ margin: 0 }}>New service</h1>
        </div>
        {children}
      </main>
    )
  }

  return (
    <main>
      <BackButton fallback="/attorney/services" />
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
      >
        <h1 style={{ margin: 0 }}>{svc?.displayName ?? 'Service'}</h1>
        {svc && (
          <span className={`badge ${svc.isActive ? 'ok' : ''}`}>
            {svc.isActive ? 'Enabled' : 'Disabled'}
          </span>
        )}
      </div>
      <ServiceTabs
        serviceKey={serviceKey}
        generationMode={svc?.generationMode ?? 'template_merge'}
      />
      {children}
    </main>
  )
}
