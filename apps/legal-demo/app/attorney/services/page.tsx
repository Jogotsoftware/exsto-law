'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

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
  const router = useRouter()
  const [services, setServices] = useState<ServiceDefinition[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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

  async function toggleActive(svc: ServiceDefinition) {
    setBusy(svc.serviceKey)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.set_active',
        input: { serviceKey: svc.serviceKey, active: !svc.isActive },
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
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
      >
        <h1 style={{ margin: 0 }}>Services</h1>
        <button
          className="primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => router.push('/attorney/services/new')}
        >
          + New service
        </button>
      </div>

      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        The offerings clients can book. Disabled services stay configured but disappear from the
        booking page. Editing a service saves a new immutable version.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {services === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : services.length === 0 ? (
        <div className="loading-block">No services yet. Create your first offering.</div>
      ) : (
        <section style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Route</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((svc) => (
                <tr key={svc.id}>
                  <td>
                    <Link href={`/attorney/services/${svc.serviceKey}`}>
                      <strong>{svc.displayName}</strong>
                    </Link>
                    {svc.description && (
                      <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                        {svc.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${svc.route === 'auto' ? 'info' : ''}`}>
                      {svc.route === 'auto' ? 'Auto-draft' : 'Manual'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${svc.isActive ? 'ok' : ''}`}>
                      {svc.isActive ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link
                      href={`/attorney/services/${svc.serviceKey}`}
                      style={{ marginRight: '0.7rem' }}
                    >
                      Edit
                    </Link>
                    <Link
                      href={`/attorney/services/${svc.serviceKey}/questionnaire`}
                      style={{ marginRight: '0.7rem' }}
                    >
                      Questionnaire
                    </Link>
                    <Link
                      href={`/attorney/services/${svc.serviceKey}/prompt`}
                      style={{ marginRight: '0.7rem' }}
                    >
                      Prompt
                    </Link>
                    <button
                      className={svc.isActive ? 'danger outline' : 'primary'}
                      onClick={() => toggleActive(svc)}
                      disabled={busy === svc.serviceKey}
                    >
                      {busy === svc.serviceKey ? '…' : svc.isActive ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
