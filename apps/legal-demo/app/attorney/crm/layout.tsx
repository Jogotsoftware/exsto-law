'use client'

import { usePathname } from 'next/navigation'
import { CrmTabs } from '@/components/CrmTabs'

// CRM section — one home for the firm's clients and contacts, with a shared tab
// bar so the two never feel separate. A client is the account (the billing parent
// that groups its contacts and matters); contacts are the people. This <main>
// wraps every page under /attorney/crm, including the client- and contact-detail
// pages, so there is always a way back — but the underline tab bar itself (comp:
// CRM list header) only belongs on the two list pages; the detail pages have
// their own "‹ Clients" / "‹ Contacts" back-pill instead (comp: CRM CLIENT
// DETAIL / CRM CONTACT DETAIL), so showing both would be chrome the comp never
// shows (README rule 3, "simpler wins").
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const showTabs = pathname === '/attorney/crm' || pathname === '/attorney/crm/contacts'
  return (
    <main>
      {showTabs && <CrmTabs />}
      {children}
    </main>
  )
}
