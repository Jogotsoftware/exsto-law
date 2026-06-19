'use client'

// Live preview of a template body — the finished document, rendered with the
// same markdown renderer the client-facing pages use, with {{tokens}} merged
// against sample data and data-driven fields flagged. Updates as the body changes.

import { useMemo } from 'react'
import { buildPreview } from '@/lib/templatePreview'

export function TemplatePreview({ body }: { body: string }) {
  const { html, gapCount } = useMemo(() => buildPreview(body), [body])

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
      <div className="tpl-preview-page" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
