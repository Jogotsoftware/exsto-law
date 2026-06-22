'use client'

// Guided setup stepper — shown in place of the plain tab bar while a service is
// still being set up (not yet enabled). It walks the attorney through each panel in
// order (Details → Questionnaire → Templates → [Prompt, ai-draft only] → Billing),
// marking each step done from the server completeness check, so creating a service
// is a guided flow instead of a scavenger hunt across tabs. Once the service is
// enabled, the [serviceKey] layout swaps this for the normal ServiceTabs.
//
// The step model + index helpers are pure (no React/Next) and live in lib/serviceSetup
// so they're unit-testable and shared with the layout's "Continue →" derivation.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeStepIndex, type SetupStep } from '@/lib/serviceSetup'

export { buildSetupSteps, type SetupStep } from '@/lib/serviceSetup'

export function ServiceSetupGuide({ steps }: { steps: SetupStep[] }) {
  const pathname = usePathname()
  const activeIdx = activeStepIndex(steps, pathname)

  return (
    <nav
      aria-label="Service setup"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.4rem',
        alignItems: 'center',
        margin: '0 0 1.1rem',
        padding: '0.6rem 0.7rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface, #fafafa)',
      }}
    >
      <span
        style={{
          fontSize: '0.78rem',
          fontWeight: 600,
          color: 'var(--muted)',
          marginRight: '0.3rem',
        }}
      >
        Set up
      </span>
      {steps.map((s, i) => {
        const active = i === activeIdx
        const circleBg = s.done ? '#166534' : active ? 'var(--text, #1a1a1a)' : 'transparent'
        const circleColor = s.done || active ? '#fff' : 'var(--muted)'
        return (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            <Link
              href={s.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.55rem',
                borderRadius: 999,
                textDecoration: 'none',
                background: active ? 'var(--ok-soft, #ecfdf5)' : 'transparent',
                color: active ? 'var(--text, #1a1a1a)' : 'var(--muted)',
                fontWeight: active ? 600 : 400,
                fontSize: '0.86rem',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: s.done || active ? 'none' : '1px solid var(--border)',
                  background: circleBg,
                  color: circleColor,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                {s.done ? '✓' : i + 1}
              </span>
              {s.label}
              {s.optional && (
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 400 }}>
                  (optional)
                </span>
              )}
            </Link>
            {i < steps.length - 1 && (
              <span aria-hidden style={{ color: 'var(--border)', margin: '0 0.1rem' }}>
                ›
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

// The bottom-of-panel "Continue →" control for the guided flow. Advances to the
// next setup step; on the last step it points back to Details, where the enable
// gate lives. Rendered by the layout below the active panel during setup.
export function ServiceSetupContinue({
  steps,
  serviceKey,
}: {
  steps: SetupStep[]
  serviceKey: string
}) {
  const pathname = usePathname()
  const idx = activeStepIndex(steps, pathname)
  const next = steps[idx + 1]
  const base = `/attorney/services/${serviceKey}`
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: '1.4rem',
        paddingTop: '1rem',
        borderTop: '1px solid var(--border)',
      }}
    >
      {next ? (
        <Link href={next.href} className="primary" style={{ textDecoration: 'none' }}>
          Save on this tab, then continue to {next.label} →
        </Link>
      ) : (
        <Link href={base} className="primary" style={{ textDecoration: 'none' }}>
          Review &amp; enable →
        </Link>
      )}
    </div>
  )
}
