import type { ReactNode } from 'react'

// FIRM-LANDING-3: a shared /book link previews as "Book services", not the
// product default. Layout exists only to carry segment metadata — /book pages
// are client components and cannot export it themselves.
export const metadata = { title: 'Book services' }

export default function BookLayout({ children }: { children: ReactNode }) {
  return children
}
