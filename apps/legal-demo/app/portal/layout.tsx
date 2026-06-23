import type { ReactNode } from 'react'
import { PortalFeedbackWidget } from '@/components/PortalFeedbackWidget'

// Wraps every /portal/* page so the client-portal feedback widget is available
// across the portal. The widget self-gates on the session, so it stays hidden on
// the unauthenticated /portal/login and /portal/set-password pages.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PortalFeedbackWidget />
    </>
  )
}
