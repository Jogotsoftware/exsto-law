// Contract J — document-view action-bar registry.
//
// The attorney document view's action bar AUTO-DISCOVERS action files in this
// folder's `actions/` directory: any `*.action.ts` that calls
// registerDocumentAction() at import time appears in the bar with zero edits
// here. This session ships `send-via-email`; the e-signature session drops in
// `send-for-signature.action.ts` and it shows up automatically.
//
// Discovery uses webpack's require.context (Next.js 15 builds with webpack), so
// a new action file needs no registration line anywhere else.

export interface DocumentActionContext {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  // Public share URL for the document version (the client-facing view).
  shareUrl: string
}

export interface DocumentActionResult {
  ok: boolean
  message: string
}

export interface DocumentAction {
  // Stable id (used as React key + dedupe). e.g. 'send-via-email'.
  id: string
  label: string
  // Lower sorts first; defaults to 100.
  order?: number
  // When set and it returns a string, the bar shows window.confirm(message)
  // before running and aborts if the user cancels.
  confirm?: (ctx: DocumentActionContext) => string | null
  // Perform the action. Throwing or returning ok:false surfaces the message.
  run: (ctx: DocumentActionContext) => Promise<DocumentActionResult>
}

const REGISTRY = new Map<string, DocumentAction>()
let discovered = false

export function registerDocumentAction(action: DocumentAction): void {
  REGISTRY.set(action.id, action)
}

// Bulk-import every actions/*.action.ts so each self-registers. webpack-only;
// guarded so a non-webpack bundler/test runner falls back to explicit imports.
function discover(): void {
  if (discovered) return
  discovered = true
  try {
    const ctx = (
      require as unknown as {
        context?: (d: string, r: boolean, re: RegExp) => { keys(): string[]; (id: string): unknown }
      }
    ).context
    if (typeof ctx === 'function') {
      const mod = ctx('./actions', false, /\.action\.(ts|tsx)$/)
      mod.keys().forEach((k) => mod(k))
    }
  } catch {
    // Non-webpack context: actions are expected to be imported explicitly
    // (the bundled send-via-email action is imported by the action bar).
  }
}

export function getDocumentActions(): DocumentAction[] {
  discover()
  return [...REGISTRY.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}
