import './globals.css'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/lib/i18n'

export const metadata = {
  title: 'Pacheco Law — wedge demo',
  description: 'Pacheco Law operating-agreement workflow demo.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
