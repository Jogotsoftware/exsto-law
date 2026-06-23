'use client'

// Service editor shell — one <main>, a persistent header (service name + status),
// and the shared navigation, wrapping every panel of a service (Settings,
// Questionnaire, Templates, Prompt, Billing). Replaces the old top-right "Edit
// questionnaire / Edit prompt / Edit templates" link soup: the sub-pages are now
// tabs under this layout, so each child renders its panel content only (no own
// <main>, no back-to-service link).
//
// While a service is still being SET UP (not yet enabled) the plain tab bar is
// replaced by a guided stepper (ServiceSetupGuide) with a "Continue →" footer, so
// creating a service walks the attorney through each tab in order. Once the service
// is enabled, it shows the normal ServiceTabs for free navigation. The create flow
// (/attorney/services/new) has no service yet, so it shows just the create form.
import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ServiceTabs } from '@/components/ServiceTabs'
import { BackButton } from '@/components/BackButton'
import {
  ServiceSetupGuide,
  ServiceSetupContinue,
  buildSetupSteps,
} from '@/components/ServiceSetupGuide'

type GenerationMode = 'template_merge' | 'ai_draft'
interface ServiceHead {
  displayName: string
  route: 'auto' | 'manual'
  generationMode: GenerationMode
  isActive: boolean
}
interface Completeness {
  ready: boolean
  missing: string[]
}

export default function ServiceEditorLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ serviceKey: string }>()
  const pathname = usePathname()
  const serviceKey = params.serviceKey
  const isNew = serviceKey === 'new'
  const [svc, setSvc] = useState<ServiceHead | null>(null)
  const [completeness, setCompleteness] = useState<Completeness | null>(null)

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    // Read the service + its completeness together so the setup stepper can mark
    // each step done. Re-read on tab navigation so a route/generation-mode change or
    // a just-saved questionnaire/template updates the stepper without a reload.
    Promise.all([
      callAttorneyMcp<{ service: ServiceHead | null }>({
        toolName: 'legal.service.get',
        input: { serviceKey },
      }),
      callAttorneyMcp<Completeness>({
        toolName: 'legal.service.completeness',
        input: { serviceKey },
      }).catch(() => null),
    ])
      .then(([s, c]) => {
        if (cancelled) return
        if (s.service) setSvc(s.service)
        if (c) setCompleteness(c)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [serviceKey, isNew, pathname])

  if (isNew) {
    return (
      <main>
        <BackButton fallback="/attorney/services" />
        <div
          className="attorney-page-head"
          style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
        >
          <h1 style={{ margin: 0 }}>New service</h1>
        </div>
        {children}
      </main>
    )
  }

  // Setup mode: the service exists but is not yet enabled, and we have the
  // completeness read to mark step progress. Otherwise show the normal tab bar.
  const inSetup = svc != null && !svc.isActive && completeness != null
  const steps =
    inSetup && svc
      ? buildSetupSteps(serviceKey, svc.generationMode, svc.route, completeness!.missing)
      : null

  return (
    <main>
      <BackButton fallback="/attorney/services" />
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
      </div>
      {steps ? (
        <ServiceSetupGuide steps={steps} />
      ) : (
        <ServiceTabs
          serviceKey={serviceKey}
          generationMode={svc?.generationMode ?? 'template_merge'}
        />
      )}
      {children}
      {steps && <ServiceSetupContinue steps={steps} serviceKey={serviceKey} />}
    </main>
  )
}
