import { CrmTabs } from '@/components/CrmTabs'

// CRM section — one home for the firm's companies, clients, and contacts. Company
// is the account (migration 0067): contacts and matters belong to a company, and
// a company engaged as a client shows under the Clients tab.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <CrmTabs />
      {children}
    </main>
  )
}
