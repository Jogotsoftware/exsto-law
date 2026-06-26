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
import { useCallback, useEffect, useState } from 'react'
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
  // Inline rename of the service from the header — so the display name is editable
  // from any tab, not only by digging into the Settings form.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  // Enablement lives in the header (top-right): one Enable/Disable button. When the
  // service isn't ready yet, clicking Enable opens a modal listing the gates rather
  // than disabling the button — the attorney sees exactly what's left to finish.
  const [completeness, setCompleteness] = useState<Completeness | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [showGates, setShowGates] = useState(false)

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

  // Re-read service + completeness on tab navigation so a generation-mode change
  // (which adds/removes the Prompt tab) or an enable/disable updates the header +
  // tabs without a reload. Completeness powers the header Enable button's gate modal.
  const load = useCallback(async () => {
    if (isNew) return
    try {
      const s = await callAttorneyMcp<{ service: ServiceHead | null }>({
        toolName: 'legal.service.get',
        input: { serviceKey },
      })
      if (s.service) setSvc(s.service)
    } catch {
      // header is non-blocking; leave prior value
    }
    try {
      const c = await callAttorneyMcp<Completeness>({
        toolName: 'legal.service.completeness',
        input: { serviceKey },
      })
      setCompleteness(c)
    } catch {
      setCompleteness(null)
    }
  }, [serviceKey, isNew])

  useEffect(() => {
    void load()
  }, [load, pathname])

  async function setActive(active: boolean) {
    setEnabling(true)
    try {
      await callAttorneyMcp({ toolName: 'legal.service.set_active', input: { serviceKey, active } })
      setShowGates(false)
      await load()
    } catch {
      // surfaced on the Settings tab; keep the header responsive
    } finally {
      setEnabling(false)
    }
  }

  // Enable only when the server says the service is ready; otherwise open the modal
  // listing what's left, so the UI and the set_active handler never disagree.
  function onEnableClick() {
    if (completeness?.ready) void setActive(true)
    else setShowGates(true)
  }

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
        {svc && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
            {svc.isActive ? (
              <button
                className="danger outline"
                onClick={() => void setActive(false)}
                disabled={enabling}
              >
                {enabling ? '…' : 'Disable service'}
              </button>
            ) : (
              <button className="primary" onClick={onEnableClick} disabled={enabling}>
                {enabling ? 'Enabling…' : 'Enable service'}
              </button>
            )}
          </div>
        )}
      </div>
      <ServiceTabs
        serviceKey={serviceKey}
        generationMode={svc?.generationMode ?? 'template_merge'}
      />
      {children}
      {showGates && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Requirements to enable this service"
          onClick={() => setShowGates(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 'var(--space-4)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #fff)',
              borderRadius: 'var(--radius, 12px)',
              padding: 'var(--space-5, 1.5rem)',
              maxWidth: '32rem',
              width: '100%',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 'var(--space-2)' }}>
              Not ready to enable yet
            </h2>
            <p style={{ marginTop: 0, color: 'var(--muted)' }}>
              Finish these before this service can go live and accept bookings:
            </p>
            <ul style={{ paddingLeft: 'var(--space-4)', color: 'var(--danger)' }}>
              {(
                completeness?.missing ?? ['Still checking requirements — try again in a moment.']
              ).map((m) => (
                <li key={m} style={{ marginBottom: 'var(--space-1)' }}>
                  {m}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 'var(--space-4)', textAlign: 'right' }}>
              <button className="primary" onClick={() => setShowGates(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
