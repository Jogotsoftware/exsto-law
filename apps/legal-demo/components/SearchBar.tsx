'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SearchIcon } from '@/components/icons'

interface ContactRow {
  contactEntityId: string
  fullName: string
  email: string
  companyName: string | null
}

interface MatterRow {
  matterEntityId: string
  matterNumber: string
  clientName: string
  summary: string
}

interface ClientRow {
  clientEntityId: string
  name: string | null
  contactCount: number
  matterCount: number
}

type Result =
  | { type: 'contact'; id: string; primary: string; secondary: string }
  | { type: 'matter'; id: string; primary: string; secondary: string }
  | { type: 'client'; id: string; primary: string; secondary: string }

export function SearchBar() {
  const router = useRouter()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [matters, setMatters] = useState<MatterRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  async function ensureLoaded() {
    if (loaded || loading) return
    setLoading(true)
    try {
      const [c, m, cl] = await Promise.all([
        callAttorneyMcp<{ contacts: ContactRow[] }>({ toolName: 'legal.contact.list' }),
        callAttorneyMcp<{ matters: MatterRow[] }>({ toolName: 'legal.matter.list' }),
        callAttorneyMcp<{ clients: ClientRow[] }>({ toolName: 'legal.client.list' }),
      ])
      setContacts(c.contacts)
      setMatters(m.matters)
      setClients(cl.clients)
      setLoaded(true)
    } catch {
      // Silent — search will just show "No matches"
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !target?.isContentEditable) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim().toLowerCase()
  const results: Result[] = []
  if (q) {
    for (const c of contacts) {
      if (results.length >= 5) break
      if (
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.companyName ?? '').toLowerCase().includes(q)
      ) {
        results.push({
          type: 'contact',
          id: c.contactEntityId,
          primary: c.fullName || c.email,
          secondary: c.companyName ?? c.email,
        })
      }
    }
    for (const cl of clients) {
      if (results.length >= 10) break
      if ((cl.name ?? '').toLowerCase().includes(q)) {
        results.push({
          type: 'client',
          id: cl.clientEntityId,
          primary: cl.name || 'Unnamed client',
          secondary: `${cl.matterCount} matter${cl.matterCount === 1 ? '' : 's'} · ${cl.contactCount} contact${cl.contactCount === 1 ? '' : 's'}`,
        })
      }
    }
    for (const m of matters) {
      if (results.length >= 15) break
      if (
        m.matterNumber.toLowerCase().includes(q) ||
        m.clientName.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q)
      ) {
        results.push({
          type: 'matter',
          id: m.matterEntityId,
          primary: m.clientName || m.matterNumber,
          secondary: m.summary || m.matterNumber,
        })
      }
    }
  }

  function go(r: Result) {
    setOpen(false)
    setQuery('')
    if (r.type === 'contact') router.push(`/attorney/contacts/${r.id}`)
    else if (r.type === 'client') router.push(`/attorney/clients/${r.id}`)
    else router.push(`/attorney/matters/${r.id}`)
  }

  return (
    <div className="search-bar-wrap" ref={wrapRef}>
      <SearchIcon size={14} className="search-icon" />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search matters, clients, contacts…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          ensureLoaded()
        }}
        onFocus={() => {
          setOpen(true)
          ensureLoaded()
        }}
        className="search-input"
      />
      <kbd className="search-kbd">/</kbd>
      {open && q && (
        <div className="search-results">
          {loading && !loaded ? (
            <div className="search-empty">
              <span className="spinner" /> Loading…
            </div>
          ) : results.length === 0 ? (
            <div className="search-empty">No matches.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.id}-${i}`}
                type="button"
                className="search-result"
                onClick={() => go(r)}
              >
                <span className={`search-result-tag tag-${r.type}`}>{r.type}</span>
                <span className="search-result-primary">{r.primary}</span>
                <span className="search-result-secondary text-muted">{r.secondary}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
