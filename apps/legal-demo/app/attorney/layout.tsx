import type { ReactNode } from 'react'
import { AttorneyHeader } from '@/components/AttorneyHeader'
import { AttorneyAuthGate } from '@/components/AttorneyAuthGate'

export default function AttorneyLayout({ children }: { children: ReactNode }) {
  return (
    <AttorneyAuthGate>
      <AttorneyHeader />
      {children}
    </AttorneyAuthGate>
  )
}
