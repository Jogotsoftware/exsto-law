'use client'

// Shared tab bar for the service editor: Settings · Questionnaire · Templates ·
// (Prompt, only for AI-draft services) · AI review · Workflow · Billing. Rendered
// by the /attorney/services/[serviceKey] layout so every panel of one service
// feels like one editor instead of separate pages, and always shown so the
// attorney can move freely between panels. The Prompt tab appears only for
// AI-draft services.
import { NavTabs } from './NavTabs'

type GenerationMode = 'template_merge' | 'ai_draft'

export function ServiceTabs({
  serviceKey,
  generationMode,
}: {
  serviceKey: string
  generationMode: GenerationMode
}) {
  const base = `/attorney/services/${serviceKey}`
  return (
    <NavTabs
      ariaLabel="Service editor"
      tabs={[
        { href: base, label: 'Settings' },
        { href: `${base}/questionnaire`, label: 'Questionnaire' },
        { href: `${base}/templates`, label: 'Templates' },
        ...(generationMode === 'ai_draft' ? [{ href: `${base}/prompt`, label: 'Prompt' }] : []),
        // AI review of client-uploaded documents — orthogonal to how the
        // service's own documents are generated, so it shows for every service.
        { href: `${base}/review`, label: 'AI Review' },
        { href: `${base}/workflow`, label: 'Workflow' },
        { href: `${base}/billing`, label: 'Billing' },
      ]}
    />
  )
}
