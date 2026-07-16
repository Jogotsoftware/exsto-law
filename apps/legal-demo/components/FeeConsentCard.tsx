'use client'

// The ONE fee-consent presentation (BUILDER-UX-3 P9, extracted for
// CLIENT-PORTAL-UI-1): the exact cost shown BEFORE anything billable proceeds,
// with an explicit acceptance. Mounted by the public booking flow, the portal's
// Schedule panel, and the portal engagement gate — never forked (doctrine 4).
// The server enforces every gate; this card is only the honest presentation.

export interface FeeConsentQuote {
  basis: string
  amount: string | null
  rate: string | null
  currency: string
  description: string
}

export function FeeConsentCard({
  quote,
  accepted,
  onAccept,
  t,
}: {
  quote: FeeConsentQuote
  accepted: boolean
  onAccept: (v: boolean) => void
  t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string
}) {
  const price =
    quote.basis === 'fixed' && quote.amount
      ? `$${quote.amount}`
      : quote.rate
        ? `$${quote.rate}/hr`
        : ''
  return (
    <div className="bk-notice bk-fee-card" role="note">
      <strong>{t('fee.title', undefined, 'Fee for this service')}</strong>
      <div>
        {quote.description} — <strong>{price}</strong>
        {quote.basis === 'hourly-rate' && (
          <> {t('fee.hourly_note', undefined, '(billed for time actually worked)')}</>
        )}
      </div>
      {/* bk-checkbox exempts this label from the global .bk-stage label rules
          (which stacked the box above bold mini-label text); bk-fee-accept makes
          it a top-aligned row whose sentence wraps at normal weight. */}
      <label className="bk-checkbox bk-fee-accept">
        <input type="checkbox" checked={accepted} onChange={(e) => onAccept(e.target.checked)} />
        <span>
          {quote.basis === 'fixed'
            ? t(
                'fee.accept_fixed',
                undefined,
                'I accept this fee. It will be billed on my invoice for this service.',
              )
            : t(
                'fee.accept_hourly',
                undefined,
                'I accept this hourly rate for work on this service.',
              )}
        </span>
      </label>
    </div>
  )
}
