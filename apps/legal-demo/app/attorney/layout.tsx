import type { ReactNode } from 'react'
import { AttorneyHeader } from '@/components/AttorneyHeader'
import { AttorneySidebar } from '@/components/AttorneySidebar'
import { AttorneyAuthGate } from '@/components/AttorneyAuthGate'

export default function AttorneyLayout({ children }: { children: ReactNode }) {
  return (
    <AttorneyAuthGate>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <AttorneySidebar />
        <div style={{ flex: 1, minWidth: 0 }}>
          <AttorneyHeader />
          {children}
        </div>
      </div>
    </AttorneyAuthGate>
  )
}
