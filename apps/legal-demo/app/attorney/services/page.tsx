'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { useConfirm } from '@/components/ConfirmModal'
import { PlusIcon, SettingsIcon } from '@/components/icons'

interface ServiceDefinition {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  route: 'auto' | 'manual'
  intakeFormId: string
  documents: string[]
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

export default function ServicesPage() {
  const { confirm, confirmElement } = useConfirm()
  const router = useRouter()
  const [services, setServices] = useState<ServiceDefinition[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // serviceKey whose gear menu is open (only one at a time).
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ services: ServiceDefinition[] }>({
        toolName: 'legal.service.list_all',
      })
      setServices(r.services)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Dismiss the gear menu on any outside click or Escape.
  useEffect(() => {
    if (!menuFor) return
    function onClick() {
      setMenuFor(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuFor(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuFor])

  async function toggleActive(svc: ServiceDefinition) {
    const next = !svc.isActive
    setError(null)
    // Flip optimistically so the toggle responds instantly; reconcile on success
    // and revert on failure.
    setServices((prev) =>
      prev
        ? prev.map((s) => (s.serviceKey === svc.serviceKey ? { ...s, isActive: next } : s))
        : prev,
    )
    setBusy(svc.serviceKey)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.set_active',
        input: { serviceKey: svc.serviceKey, active: next },
      })
      await refresh()
    } catch (e) {
      // Revert the optimistic flip. Enabling is gated on completeness; surface
      // the "what's missing" message.
      setServices((prev) =>
        prev
          ? prev.map((s) => (s.serviceKey === svc.serviceKey ? { ...s, isActive: !next } : s))
          : prev,
      )
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function clone(svc: ServiceDefinition) {
    setMenuFor(null)
    setBusy(svc.serviceKey)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.clone',
        input: { serviceKey: svc.serviceKey },
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove(svc: ServiceDefinition) {
    setMenuFor(null)
    const ok = await confirm({
      title: `Delete “${svc.displayName}”?`,
      body: 'The service is retired and removed from every listing. Its history is kept, but it can’t be re-enabled.',
      confirmLabel: 'Delete service',
      danger: true,
    })
    if (!ok) return
    setBusy(svc.serviceKey)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.retire',
        input: { serviceKey: svc.serviceKey },
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main>
      {confirmElement}
      <div className="li-svc-list-head">
        <h1>Services</h1>
        <button
          type="button"
          className="li-svc-newbtn"
          onClick={() => router.push('/attorney/services/new')}
        >
          <PlusIcon size={15} />
          New service
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {services === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : services.length === 0 ? (
        <p className="li-svc-empty">No services yet. Create your first offering.</p>
      ) : (
        <div className="li-svc-listcard">
          {services.map((svc) => (
            <div
              key={svc.id}
              role="button"
              tabIndex={0}
              className="li-svc-row"
              onClick={() => router.push(`/attorney/services/${svc.serviceKey}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  router.push(`/attorney/services/${svc.serviceKey}`)
                }
              }}
            >
              <div className="li-svc-row-main">
                <div className="li-svc-row-name">{svc.displayName}</div>
                {svc.description && <div className="li-svc-row-desc">{svc.description}</div>}
              </div>
              <button
                type="button"
                className={`li-svc-badge${svc.isActive ? ' is-active' : ''}`}
                disabled={busy === svc.serviceKey}
                aria-pressed={svc.isActive}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleActive(svc)
                }}
                title={
                  svc.isActive
                    ? 'Active — shown on the booking page. Click to disable.'
                    : 'Inactive — hidden from booking. Click to enable.'
                }
              >
                <span className="li-svc-badge-dot" aria-hidden="true" />
                {svc.isActive ? 'Active' : 'Inactive'}
              </button>
              {/* The menu anchors to this span (which wraps only the gear), not the
                  full-height row — otherwise on a two-line row its `top: 100%` drops
                  it an inch below the gear. */}
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  type="button"
                  className="li-svc-row-gear"
                  aria-label="Service actions"
                  aria-haspopup="menu"
                  disabled={busy === svc.serviceKey}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuFor(menuFor === svc.serviceKey ? null : svc.serviceKey)
                  }}
                >
                  <SettingsIcon size={18} />
                </button>
                {menuFor === svc.serviceKey && (
                  <div className="row-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null)
                        router.push(`/attorney/services/${svc.serviceKey}`)
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" role="menuitem" onClick={() => clone(svc)}>
                      Clone
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="row-menu-danger"
                      onClick={() => remove(svc)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
