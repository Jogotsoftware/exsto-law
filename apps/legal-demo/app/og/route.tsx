import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { getPublicFirmSite } from '@exsto/legal'
import { FirmMarkGlyph } from '@/components/FirmMarkGlyph'
import { isHexColor } from '@/lib/brandColor'

// FIRM-LANDING-3 — the per-tenant link-share image. On a firm host this
// renders the firm's mark (the "attorney logo": the scales crest tinted the
// firm's brand color) centered on the landing's cream field, so pasting
// pacheco.instruments.legal into iMessage/Slack previews the firm, not a
// placeholder compass. Host-authoritative like the page itself: the slug
// comes only from middleware-injected headers, and an unresolvable firm gets
// the product-blue mark rather than an error card.
//
// Deliberately TEXT-FREE: the share card's title line already carries the
// firm name (generateMetadata), and no text means Satori needs no font data.

export const dynamic = 'force-dynamic'

const DEFAULT_BRAND = '#4B9CD3'

export async function GET(): Promise<Response> {
  const h = await headers()
  const slug = (h.get('x-firm-slug') ?? '').trim().toLowerCase()
  let brand = DEFAULT_BRAND
  if (slug && h.get('x-firm-host') === '1') {
    const site = await getPublicFirmSite(slug).catch(() => null)
    if (site && isHexColor(site.headerColor)) brand = site.headerColor
  }
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 85% -10%, #EAF3FA 0%, #F6EFE2 55%, #F3EBDC 100%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 400,
          height: 400,
          borderRadius: 96,
          background: '#FFFFFF',
          border: '3px solid rgba(75, 156, 211, 0.28)',
          boxShadow: '0 40px 90px rgba(19, 41, 75, 0.18)',
        }}
      >
        <FirmMarkGlyph brand={brand} size={300} />
      </div>
    </div>,
    { width: 1200, height: 630 },
  )
}
