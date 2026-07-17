'use client'

// In-app replacements for the banned native dialogs (RUNNER-FIXES-1 WP3).
// Native confirm/alert/prompt are forbidden in this app — every confirmation is
// a Modal with an explicit consequence line and labeled actions, and every text
// ask is a Modal with a real input. Two shapes:
//
//   • <ConfirmModal>/<PromptModal> — declarative, for components that already
//     manage their own open/closed state.
//   • useConfirm()/usePrompt() — imperative await-style hooks for the many call
//     sites that used to gate an async handler on a native confirm. They
//     resolve `true`/the entered string on confirm and `false`/`null` on any
//     dismissal (Cancel, ×, backdrop, Escape) — the exact contract the native
//     dialogs had, so handlers keep their early-return shape.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: ReactNode
  // One-line consequence of confirming — what happens, not a question restated.
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  // Destructive-action variant: the confirm button renders as the warning style.
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="li-modal-btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'li-modal-btn-danger' : 'li-modal-btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy && <span className="spinner" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
    </Modal>
  )
}

export function PromptModal({
  title,
  body,
  label,
  placeholder,
  defaultValue = '',
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: ReactNode
  body?: ReactNode
  label: string
  placeholder?: string
  defaultValue?: string
  confirmLabel: string
  // Called with the trimmed value; the button stays disabled while it's empty.
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultValue)
  const canSubmit = value.trim().length > 0
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="li-modal-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="li-modal-btn-primary"
            onClick={() => canSubmit && onSubmit(value.trim())}
            disabled={!canSubmit}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {body && <p style={{ marginTop: 0 }}>{body}</p>}
      <label className="li-modal-field">
        <span>{label}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onSubmit(value.trim())
          }}
        />
      </label>
    </Modal>
  )
}

export interface ConfirmOptions {
  title: ReactNode
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

// Await-style confirm. Render {confirmElement} once in the component's JSX and
// call `const ok = await confirm({...})` anywhere a native confirm used to sit.
export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  confirmElement: ReactNode
} {
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A second ask while one is open dismisses the first — same as the native
      // dialog, which could never stack.
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setPending(opts)
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setPending(null)
  }, [])

  const confirmElement = pending ? (
    <ConfirmModal
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, confirmElement }
}

export interface PromptOptions {
  title: ReactNode
  body?: ReactNode
  label: string
  placeholder?: string
  defaultValue?: string
  confirmLabel: string
}

// Await-style prompt: resolves the trimmed string, or null on dismissal.
export function usePrompt(): {
  prompt: (opts: PromptOptions) => Promise<string | null>
  promptElement: ReactNode
} {
  const [pending, setPending] = useState<PromptOptions | null>(null)
  const resolveRef = useRef<((v: string | null) => void) | null>(null)

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current?.(null)
      resolveRef.current = resolve
      setPending(opts)
    })
  }, [])

  const settle = useCallback((v: string | null) => {
    resolveRef.current?.(v)
    resolveRef.current = null
    setPending(null)
  }, [])

  const promptElement = pending ? (
    <PromptModal
      title={pending.title}
      body={pending.body}
      label={pending.label}
      placeholder={pending.placeholder}
      defaultValue={pending.defaultValue}
      confirmLabel={pending.confirmLabel}
      onSubmit={(v) => settle(v)}
      onCancel={() => settle(null)}
    />
  ) : null

  return { prompt, promptElement }
}
