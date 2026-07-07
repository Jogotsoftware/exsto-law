'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { fetchSession } from '@/lib/auth'

export function AttorneyAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The session is an httpOnly cookie, so we can't read it synchronously —
    // ask the server (/api/auth/me) whether we're signed in.
    fetchSession()
      .then((session) => {
        if (cancelled) return
        if (!session) {
          router.replace('/')
        } else {
          setOk(true)
        }
      })
      .catch(() => {
        if (!cancelled) router.replace('/')
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [router])

  if (checking || !ok) {
    return (
      <main>
        <div className="loading-block" role="status">
          <span className="spinner" /> Checking session…
        </div>
      </main>
    )
  }
  return <>{children}</>
}
