import type { ReactNode } from 'react'
import { AdminAuthGate } from '@/components/AdminAuthGate'
import { AdminTopNav } from '@/components/AdminTopNav'

// Gated console shell (ADR 0046). The route group `(console)` keeps the sign-in
// page at /admin OUTSIDE this gate while everything under it (tenants, modules,
// sandbox, access, audit) is admin-only.
export default function AdminConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthGate>
      <AdminTopNav />
      <div id="main" tabIndex={-1} style={{ padding: '1.5rem' }}>
        {children}
      </div>
    </AdminAuthGate>
  )
}
