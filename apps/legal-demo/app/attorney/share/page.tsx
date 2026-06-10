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
}

export default function SharePage() {
  const [services, setServices] = useState<Service[] | null>(null)
  const [selected, setSelected] = useState<string | ''>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    callAttorneyMcp<{ services: Service[] }>({ toolName: 'legal.service.list' }).then((r) =>
      setServices(r.services),
    )
  }, [])

  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/book` : '/book'
  const link = selected ? `${baseUrl}?service=${selected}` : baseUrl

  async function copy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main>
      <p style={{ fontSize: '0.88rem' }}>
        <Link href="/attorney">← Matters</Link>
      </p>
      <h1>Share a booking link</h1>
      <p style={{ color: 'var(--muted)' }}>
        Pick a service to pre-select for the client, or share the generic link and let them choose.
        Auto-booked — once the client picks a time, it lands here.
      </p>

      <section>
        <label>
          <span>Service to pre-select (optional)</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— Let the client choose —</option>
            {services?.map((s) => (
              <option key={s.serviceKey} value={s.serviceKey}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>

        <div className="share-link-box">{link}</div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button className="primary" onClick={copy}>
            Copy link
          </button>
          <a href={link} target="_blank" rel="noopener noreferrer">
            <button>Open in new tab</button>
          </a>
          {copied && <span style={{ color: 'var(--ok)' }}>Copied!</span>}
        </div>
      </section>
    </main>
  )
}
