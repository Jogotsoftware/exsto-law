'use client'

// Shared tab bar for the CRM section: Clients (the accounts — the billing parent
// that groups contacts + matters) and Contacts (the people). Both live under the
// /attorney/crm layout, which renders this bar, so the two always feel like one
// section and you can never get stranded with no way back.
import { NavTabs } from './NavTabs'

export function CrmTabs() {
  return (
    <NavTabs
      ariaLabel="CRM"
      tabs={[
        { href: '/attorney/crm', label: 'Clients' },
        { href: '/attorney/crm/contacts', label: 'Contacts' },
      ]}
    />
  )
}
