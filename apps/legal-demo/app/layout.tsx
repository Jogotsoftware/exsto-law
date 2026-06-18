import './globals.css'
import type { ReactNode } from 'react'
import { Inter, EB_Garamond } from 'next/font/google'
import { I18nProvider } from '@/lib/i18n'

// Modern legal-tech type system (platform redesign): Inter for all UI/body,
// EB Garamond reserved for the firm wordmark + page heroes (a touch of legal
// gravitas). Self-hosted by next/font — no render-blocking request, swap
// fallback — and exposed as CSS variables the stylesheet reads.
const inter = Inter({
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

// Product wordmark — kept in sync with the email sender display name
// (adapters/gmail.ts FIRM_SENDER_DISPLAY_NAME). The fuller single-source-of-truth
// brand module (lib/brand.ts) lands with the Surface/Brand work; this is the
// canary fix so no browser tab reads "wedge demo".
export const metadata = {
  title: 'Pacheco Law — Legal Instruments',
  description: 'Pacheco Law — AI-native legal practice.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${ebGaramond.variable}`}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
