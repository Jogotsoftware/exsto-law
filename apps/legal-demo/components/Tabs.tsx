'use client'

import { useState, type ReactNode } from 'react'

export interface TabSpec {
  key: string
  label: ReactNode
  count?: number
  content: ReactNode
}

interface TabsProps {
  tabs: TabSpec[]
  defaultTab?: string
}

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key ?? '')
  const current = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div className="tabs">
      <div className="tabs-bar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`tab ${active === t.key ? 'active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
            {typeof t.count === 'number' && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="tabs-content" role="tabpanel">
        {current?.content}
      </div>
    </div>
  )
}
