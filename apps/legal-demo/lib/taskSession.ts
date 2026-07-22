// TASK-QUEUE-3 — a step-through session across the Task Queue's two walkable
// task types (document review, e-sign). Started from the queue's "Start Tasks"
// (any mix of selected document_review + esign rows), it lets the attorney
// dispose one task after another without returning to the queue in between —
// mirroring the pre-existing document-review-only "Begin Review" session, now
// generalized so a walk can cross from a draft straight into a signature.
export const TASK_SESSION_KEY = 'taskSession'

export type WalkableTaskType = 'document_review' | 'esign'

export interface TaskSessionItem {
  id: string
  type: WalkableTaskType
}

export interface TaskSession {
  items: TaskSessionItem[]
  index: number
}

// The route a session item's page lives at — document_review continues to use
// the review reader, esign the signing surface. Both pages read the same
// `?queue=session` flag off the URL to know they're mid-walk.
export function hrefFor(item: TaskSessionItem): string {
  const base = item.type === 'esign' ? `/attorney/sign/${item.id}` : `/attorney/review/${item.id}`
  return `${base}?queue=session`
}

export function readTaskSession(): TaskSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(TASK_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { items?: unknown; index?: unknown }
    if (!Array.isArray(parsed.items)) return null
    return { items: parsed.items as TaskSessionItem[], index: Number(parsed.index) || 0 }
  } catch {
    return null
  }
}

export function writeTaskSession(session: TaskSession): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(TASK_SESSION_KEY, JSON.stringify(session))
}

export function clearTaskSession(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(TASK_SESSION_KEY)
}
