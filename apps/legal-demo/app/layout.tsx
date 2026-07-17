import './globals.css'
import type { ReactNode } from 'react'
import type { Viewport } from 'next'
import { Public_Sans, EB_Garamond } from 'next/font/google'
import { I18nProvider } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/brand'

// Legal Instruments type system (docs/design/legal-instruments): Public Sans
// for all UI/body — the redesign comp's typeface — with EB Garamond reserved
// for the firm wordmark, page heroes, and document bodies (legal gravitas).
// Self-hosted by next/font — no render-blocking request, swap fallback — and
// exposed as CSS variables the stylesheet reads.
const publicSans = Public_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
})
const ebGaramond = EB_Garamond({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  weight: ['500', '600', '700'],
})

export const metadata = {
  title: PRODUCT_NAME,
  applicationName: PRODUCT_NAME,
  description: 'Intake, drafting, and matter workspace for Pacheco Law Firm.',
}

// Explicit, audited viewport: device-width + initial-scale (pinch-zoom left
// enabled — never disable it on a legal product), navy theme-color so mobile
// browser chrome matches the top bar, and viewport-fit=cover so safe-area
// insets become available on notched phones.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e1f3f',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${ebGaramond.variable}`}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
