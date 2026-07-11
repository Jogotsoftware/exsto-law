'use client'

import type { ReactNode } from 'react'
import { CheckCircleIcon, ClockIcon, FileTextIcon, ChevronRightIcon } from '@/components/icons'

// The ONE workflow step-list visual (UI-BUILDER-FIX-1 Phase 4 / 5b). A live
// matter's Workflow window and the builder's proposal-review card render the
// SAME component — .step-list / .step-row (globals.css), the exact look the
// attorney already knows from running matters. Purely presentational: state,
// labels and an optional meta line come in as data; an item with onClick renders
// as a button row (the matter window opens the step pop-up), without one it's a
// static row (a proposal isn't running yet).
export type WorkflowStepVisualState = 'done' | 'current' | 'pending'

export interface WorkflowStepListItem {
  key: string
  title: string
  subtitle?: string
  state: WorkflowStepVisualState
  // Extra line under the subtitle (proposal card: action · gate · documents).
  meta?: ReactNode
  onClick?: () => void
}

function StepIcon({ state }: { state: WorkflowStepVisualState }) {
  if (state === 'done') return <CheckCircleIcon size={18} />
  if (state === 'current') return <ClockIcon size={18} />
  return <FileTextIcon size={18} />
}

function stateLabel(state: WorkflowStepVisualState): string {
  if (state === 'done') return 'Done'
  if (state === 'current') return 'Current'
  return 'Pending'
}

export function WorkflowStepList({
  items,
  showStatePill = true,
}: {
  items: WorkflowStepListItem[]
  // The proposal card hides the Done/Current/Pending pill — a proposed workflow
  // has no run state to be honest about (no-simulate).
  showStatePill?: boolean
}) {
  return (
    <div className="step-list">
      {items.map((it) => {
        const inner = (
          <>
            <span className="step-ico" aria-hidden>
              <StepIcon state={it.state} />
            </span>
            <span className="step-titles">
              <span className="step-title">{it.title}</span>
              {it.subtitle ? <span className="step-subtitle">{it.subtitle}</span> : null}
              {it.meta ? <span className="step-subtitle">{it.meta}</span> : null}
            </span>
            {showStatePill && <span className="step-state-pill">{stateLabel(it.state)}</span>}
            {it.onClick ? (
              <span className="step-chevron" aria-hidden>
                <ChevronRightIcon size={16} />
              </span>
            ) : null}
          </>
        )
        return it.onClick ? (
          <button
            key={it.key}
            type="button"
            className={`step-row step-${it.state}`}
            onClick={it.onClick}
          >
            {inner}
          </button>
        ) : (
          <div key={it.key} className={`step-row step-${it.state}`}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}
