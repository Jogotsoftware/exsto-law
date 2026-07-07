import type { ReactNode } from 'react'

interface PageHeadProps {
  title: ReactNode
  actions?: ReactNode
}

export function PageHead({ title, actions }: PageHeadProps) {
  return (
    <div className="attorney-page-head">
      <div className="page-head-titles">
        <h1>{title}</h1>
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  )
}
