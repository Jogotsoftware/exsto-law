'use client'

// Live preview of a template body — the finished document, rendered with the
// same markdown renderer the client-facing pages use, with {{tokens}} merged
// against sample data and data-driven fields flagged. Updates as the body changes.

import { useMemo } from 'react'
import type { TemplateVariables } from '@exsto/legal'
import { buildPreview } from '@/lib/templatePreview'
import { useFitToWidth } from '@/lib/useFitToWidth'

export function TemplatePreview({
  body,
  variables,
}: {
  body: string
  variables?: TemplateVariables
}) {
  const { html, gapCount } = useMemo(
    () => buildPreview(body, undefined, variables),
    [body, variables],
  )

  // Zoom-to-fit so the preview page matches the editor page exactly.
  const fitRef = useFitToWidth<HTMLDivElement>()

  return (
    <div className="tpl-preview">
      <div className="tpl-preview-bar">
        <span className="tpl-preview-tag">Preview · sample data</span>
        {gapCount > 0 && (
          <span className="tpl-preview-note">
            {gapCount} field{gapCount === 1 ? '' : 's'} filled from client intake
          </span>
        )}
      </div>
      <div className="tpl-preview-desk" ref={fitRef}>
        <div className="tpl-preview-page" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
