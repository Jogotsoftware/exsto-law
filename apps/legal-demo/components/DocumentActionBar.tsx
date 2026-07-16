'use client'

// Contract J — renders the auto-discovered document actions for the attorney
// document view. Each action self-registers in lib/documentActions; this
// component just lists them, handles the optional confirm prompt, runs the
// action, and surfaces its result. A sibling session adds an action file and it
// appears here with no change to this component.
import { useMemo, useState } from 'react'
import { useConfirm } from '@/components/ConfirmModal'
import { getDocumentActions, type DocumentActionContext } from '@/lib/documentActions/registry'
// Bundled action — explicit import guarantees registration even if the webpack
// require.context discovery is unavailable (e.g. a non-webpack test runner).
import '@/lib/documentActions/actions/send-via-email.action'

export function DocumentActionBar({ context }: { context: DocumentActionContext }) {
  const actions = useMemo(() => getDocumentActions(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const { confirm, confirmElement } = useConfirm()

  async function run(actionId: string) {
    const action = actions.find((a) => a.id === actionId)
    if (!action) return
    const confirmMsg = action.confirm?.(context) ?? null
    if (confirmMsg) {
      const ok = await confirm({
        title: action.label,
        body: confirmMsg,
        confirmLabel: action.label,
      })
      if (!ok) return
    }
    setBusy(actionId)
    setStatus(null)
    try {
      const result = await action.run(context)
      setStatus({ kind: result.ok ? 'ok' : 'err', msg: result.message })
      if (result.ok) setTimeout(() => setStatus(null), 6000)
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  if (actions.length === 0) return null

  return (
    <>
      {confirmElement}
      {actions.map((action) => (
        <button key={action.id} onClick={() => run(action.id)} disabled={busy !== null}>
          {busy === action.id && <span className="spinner" />}
          {busy === action.id ? 'Working…' : action.label}
        </button>
      ))}
      {status && (
        <span
          role="status"
          className={status.kind === 'ok' ? 'badge ok' : 'badge danger'}
          style={{ alignSelf: 'center' }}
        >
          {status.msg}
        </span>
      )}
    </>
  )
}
