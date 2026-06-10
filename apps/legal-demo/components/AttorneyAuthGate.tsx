'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { readSession } from '@/lib/auth'

export function AttorneyAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const session = readSession()
    if (!session) {
      router.replace('/')
    } else {
      setOk(true)
    }
    setChecking(false)
  }, [router])

  if (checking || !ok) {
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Checking session…
        </div>
      </main>
    )
  }
  return <>{children}</>
}
