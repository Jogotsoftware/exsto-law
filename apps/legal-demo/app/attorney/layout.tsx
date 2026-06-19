import type { ReactNode } from 'react'
import { AttorneyTopNav } from '@/components/AttorneyTopNav'
import { AttorneyAuthGate } from '@/components/AttorneyAuthGate'
import { FeedbackChat } from '@/components/FeedbackChat'

export default function AttorneyLayout({ children }: { children: ReactNode }) {
  return (
    <AttorneyAuthGate>
      <AttorneyTopNav />
      {children}
      {/* Floating beta-feedback assistant — inside the gate, so attorneys only. */}
      <FeedbackChat />
    </AttorneyAuthGate>
  )
}
