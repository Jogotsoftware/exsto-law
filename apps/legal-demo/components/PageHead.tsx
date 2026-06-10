import type { ReactNode } from 'react'

interface PageHeadProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHead({ title, description, actions }: PageHeadProps) {
  return (
    <div className="attorney-page-head">
      <div className="page-head-titles">
        <h1>{title}</h1>
        {description && <p className="page-head-desc">{description}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  )
}
