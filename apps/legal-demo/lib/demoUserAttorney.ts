'use client'

import { useEffect, useState } from 'react'

export interface AttorneyIdentity {
  key: string
  displayName: string
  role: 'attorney'
}

const KNOWN: Record<string, AttorneyIdentity> = {
  'juan-carlos': { key: 'juan-carlos', displayName: 'Juan Carlos Pacheco', role: 'attorney' },
}

export function useAttorneyIdentity(): AttorneyIdentity | null {
  const [identity, setIdentity] = useState<AttorneyIdentity | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('demo_user')
    const storageKey = 'attorney_demo_user'
    if (fromQuery) {
      sessionStorage.setItem(storageKey, fromQuery)
      setIdentity(KNOWN[fromQuery] ?? null)
      return
    }
    const stored = sessionStorage.getItem(storageKey)
    if (stored) setIdentity(KNOWN[stored] ?? null)
  }, [])
  return identity
}
