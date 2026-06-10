'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface Service {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  isActive: boolean
  updatedAt: string
}

export default function ServicesList() {
  const [services, setServices] = useState<Service[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ services: Service[] }>({ toolName: 'legal.service.list' })
      .then((r) => setServices(r.services))
      .catch((e) => setError(e.message))
  }, [])

  return (
    <main>
      <div className="attorney-page-head">
        <h1>Services</h1>
      </div>
      <p style={{ color: 'var(--muted)' }}>
        These are the services prospective clients can pick from on the booking page. Edit any
        intake form to customize what you collect before the consultation.
      </p>
      {error && <pre>{error}</pre>}
      {services === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {services && (
        <section style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Description</th>
                <th>Active</th>
                <th>Last updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.serviceKey}>
                  <td>
                    <strong>{s.displayName}</strong>
                    <br />
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      <code>{s.serviceKey}</code>
                    </span>
                  </td>
                  <td>{s.description ?? <em style={{ color: 'var(--muted)' }}>—</em>}</td>
                  <td>
                    {s.isActive ? (
                      <span className="badge ok">Active</span>
                    ) : (
                      <span className="badge danger">Inactive</span>
                    )}
                  </td>
                  <td>{new Date(s.updatedAt).toLocaleDateString()}</td>
                  <td>
                    <Link href={`/attorney/services/${s.serviceKey}`}>Edit intake →</Link>
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
