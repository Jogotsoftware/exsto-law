import { CrmTabs } from '@/components/CrmTabs'

// CRM section — one home for the firm's clients and contacts, with a shared tab
// bar so the two never feel separate. A client is the account (the billing parent
// that groups its contacts and matters); contacts are the people. This <main> +
// CrmTabs wraps every page under /attorney/crm, including the client- and
// contact-detail pages, so there is always a way back.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <CrmTabs />
      {children}
    </main>
  )
}
