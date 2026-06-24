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
  // Inline rename of the service from the header — so the display name is editable
  // from any tab, not only by digging into the Settings form.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)

  async function saveName() {
    const next = nameDraft.trim()
    if (!svc || !next || next === svc.displayName) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    try {
      // legal.service.update merges: only displayName changes, the rest carries forward.
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: { serviceKey, displayName: next },
      })
      setSvc({ ...svc, displayName: next })
      setEditingName(false)
    } catch {
      // Keep the editor open so the attorney can retry; the value is preserved.
    } finally {
      setSavingName(false)
    }
  }

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
      <BackButton fallback="/attorney/services" forceFallback />
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
      >
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              else if (e.key === 'Escape') setEditingName(false)
            }}
            disabled={savingName}
            aria-label="Service display name"
            className="svc-name-edit"
          />
        ) : (
          <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            {svc?.displayName ?? 'Service'}
            {svc && (
              <button
                type="button"
                className="svc-rename-btn"
                title="Rename service"
                aria-label="Rename service"
                onClick={() => {
                  setNameDraft(svc.displayName)
                  setEditingName(true)
                }}
              >
                ✎
              </button>
            )}
          </h1>
        )}
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
