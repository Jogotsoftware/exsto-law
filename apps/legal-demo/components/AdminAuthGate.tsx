'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { fetchAdminSession } from '@/lib/mcpAdmin'

// Gate for the /admin console (ADR 0046). The admin session is an httpOnly cookie,
// so we ask the server (/admin/api/auth/me). No valid admin session → bounce to the
// admin sign-in page (/admin), NOT the attorney sign-in (/).
export function AdminAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAdminSession()
      .then((session) => {
        if (cancelled) return
        if (!session) {
          router.replace('/admin')
        } else {
          setOk(true)
        }
      })
      .catch(() => {
        if (!cancelled) router.replace('/admin')
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
          <span className="spinner" /> Checking admin session…
        </div>
      </main>
    )
  }
  return <>{children}</>
}
