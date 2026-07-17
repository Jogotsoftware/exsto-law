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

// `default` renders the legacy inline search (still used by the retired
// AttorneyTopNav); `topbar` renders the Legal Instruments comp's expandable
// navy search — a 40px icon that grows to a 360px field. Both share the exact
// same query + routing logic below.
export function SearchBar({ variant = 'default' }: { variant?: 'default' | 'topbar' }) {
  const router = useRouter()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // topbar only: whether the pill is expanded to reveal the input.
  const [expanded, setExpanded] = useState(false)
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [matters, setMatters] = useState<MatterRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const isTopbar = variant === 'topbar'

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
    if (!open && !expanded) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setExpanded(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setExpanded(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, expanded])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !target?.isContentEditable) {
        e.preventDefault()
        setExpanded(true)
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
    setExpanded(false)
    setQuery('')
    if (r.type === 'contact') router.push(`/attorney/crm/contacts/${r.id}`)
    else if (r.type === 'client') router.push(`/attorney/crm/${r.id}`)
    else router.push(`/attorney/matters/${r.id}`)
  }

  if (isTopbar) {
    return (
      <div className="li-top-search-wrap" ref={wrapRef}>
        <div className={`li-top-search${expanded ? ' li-top-search--open' : ''}`}>
          <button
            type="button"
            className="li-top-search-btn"
            aria-label="Search"
            aria-expanded={expanded}
            onClick={() => {
              const next = !expanded
              setExpanded(next)
              if (next) {
                ensureLoaded()
                // Focus after the width transition begins so the caret lands.
                requestAnimationFrame(() => inputRef.current?.focus())
              } else {
                setOpen(false)
              }
            }}
          >
            <SearchIcon size={19} />
          </button>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search matters, clients, documents…"
            aria-label="Search matters, clients, documents"
            autoComplete="off"
            spellCheck={false}
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
            className="li-top-search-input"
          />
        </div>
        {expanded && open && q && (
          <div className="li-top-search-results" aria-live="polite">
            {loading && !loaded ? (
              <div className="li-top-search-empty">
                <span className="spinner" /> Loading…
              </div>
            ) : results.length === 0 ? (
              <div className="li-top-search-empty">No matches.</div>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.type}-${r.id}-${i}`}
                  type="button"
                  className="li-top-search-result"
                  onClick={() => go(r)}
                >
                  <span className={`li-top-search-tag tag-${r.type}`}>{r.type}</span>
                  <span className="li-top-search-primary">{r.primary}</span>
                  <span className="li-top-search-secondary">{r.secondary}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="search-bar-wrap" ref={wrapRef}>
      <SearchIcon size={14} className="search-icon" />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search matters, clients, contacts…"
        aria-label="Search matters, clients, contacts"
        autoComplete="off"
        spellCheck={false}
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
        <div className="search-results" aria-live="polite">
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
