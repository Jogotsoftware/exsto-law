'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — one placed field on the canvas: absolutely
// positioned (percent coords → resolution-independent), signer-colored, drag to
// move, 8-handle resize when selected. Signature/initials boxes read as
// SIGNATURE-LIKE (script glyph + baseline rule, §4's treatment), not plain
// pills. Pure presentational + pointer geometry; all state lives in the parent.
import { useRef } from 'react'
import type { FieldPlacement } from '@exsto/legal/esign'
import { CheckIcon, XIcon } from '@/components/icons'
import { guidedActionLabel, placementGlyph } from './fieldMeta'

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeHandle = (typeof HANDLES)[number]

/** ESIGN-GUIDED-1 — the guided signer walk's per-field state (SignDocument
 *  computes this; FieldBox only renders it). `auto` = date/name/already-
 *  resolved — never clickable, always reads as filled-automatically. */
export interface GuidedFieldState {
  complete: boolean
  auto: boolean
  editing: boolean
}

export interface FieldBoxProps {
  placement: FieldPlacement
  /** 1-based palette tone index for the owning signer (li-esign2 tokens). */
  toneIndex: number
  selected: boolean
  /** Other-signer boxes render dimmed (§4: active full-opacity, others dimmed). */
  dimmed: boolean
  /** Read-only render (preview mode / review / detail). */
  readOnly: boolean
  /** The resolved auto-fill value to display, if any (§5.3). */
  displayValue?: string | null
  /** ESIGN-GUIDED-1 — the adopted signature/initials image to stamp in place
   *  once this sign/initial field has been applied. Takes priority over
   *  displayValue's text rendering when present. */
  image?: string | null
  /** ESIGN-GUIDED-1 — guided-walk state (undefined outside the signer surface). */
  guided?: GuidedFieldState
  /** ESIGN-GUIDED-1 — live value while `guided.editing` is true. */
  editingValue?: string
  onEditingChange?: (id: string, value: string) => void
  onEditingCommit?: (id: string) => void
  onSelect?: (id: string) => void
  /** Pointer drag: dx/dy in NORMALIZED page units (parent converts px). */
  onDragStart?: (id: string) => void
  onDragMove?: (id: string, dxNorm: number, dyNorm: number) => void
  onDragEnd?: (id: string) => void
  onResizeMove?: (id: string, handle: ResizeHandle, dxNorm: number, dyNorm: number) => void
  onResizeEnd?: (id: string) => void
  onDelete?: (id: string) => void
  /** Signer-surface tap (fill this field). */
  onActivate?: (id: string) => void
  /** Page wrapper size in CSS px — converts pointer px → normalized units. */
  pageCssSize: { width: number; height: number }
}

export function FieldBox({
  placement: p,
  toneIndex,
  selected,
  dimmed,
  readOnly,
  displayValue,
  image,
  guided,
  editingValue,
  onEditingChange,
  onEditingCommit,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResizeMove,
  onResizeEnd,
  onDelete,
  onActivate,
  pageCssSize,
}: FieldBoxProps) {
  const gesture = useRef<{
    mode: 'move' | ResizeHandle
    startX: number
    startY: number
  } | null>(null)

  function beginGesture(e: React.PointerEvent, mode: 'move' | ResizeHandle) {
    if (readOnly) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    gesture.current = { mode, startX: e.clientX, startY: e.clientY }
    onSelect?.(p.id)
    if (mode === 'move') onDragStart?.(p.id)
  }

  function moveGesture(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || readOnly) return
    const dxNorm = (e.clientX - g.startX) / pageCssSize.width
    const dyNorm = (e.clientY - g.startY) / pageCssSize.height
    if (g.mode === 'move') onDragMove?.(p.id, dxNorm, dyNorm)
    else onResizeMove?.(p.id, g.mode, dxNorm, dyNorm)
  }

  function endGesture() {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    if (g.mode === 'move') onDragEnd?.(p.id)
    else onResizeEnd?.(p.id)
  }

  const glyph = placementGlyph(p.type)
  const isSig = p.type === 'sign' || p.type === 'initial'
  const caption = p.label || glyph.label
  // A checkbox's "value" is the literal string 'true'/'' — never text to show;
  // its checked state reads through guided.complete's checkmark instead.
  const shown = p.type === 'check' ? '' : (displayValue ?? p.value ?? '').trim()
  // Interactivity preserves the pre-existing editor/preview rule (button
  // whenever NOT readOnly, or readOnly with an onActivate handler) and adds
  // ONE new gate: a guided auto field (date/name/already-resolved) never
  // activates — the signer watches it fill on its own, never clicks into it.
  const interactive = !readOnly || (Boolean(onActivate) && !guided?.auto)
  const editing = Boolean(guided?.editing)

  return (
    <div
      id={`esp-field-${p.id}`}
      className={[
        'li-esp-box',
        `li-esign2-tone-${toneIndex}`,
        isSig ? 'li-esp-box--sig' : '',
        selected ? 'is-selected' : '',
        dimmed ? 'is-dimmed' : '',
        readOnly ? 'is-readonly' : '',
        guided?.auto ? 'li-esp-box--auto' : '',
        guided?.complete && !guided.auto ? 'is-complete' : '',
        guided && !guided.complete && !guided.auto && !p.required ? 'is-optional' : '',
        editing ? 'is-editing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: `${p.rect.x * 100}%`,
        top: `${p.rect.y * 100}%`,
        width: `${p.rect.w * 100}%`,
        height: `${p.rect.h * 100}%`,
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={`${caption} field`}
      onPointerDown={(e) => beginGesture(e, 'move')}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onClick={(e) => {
        e.stopPropagation()
        if (interactive) onActivate?.(p.id)
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && interactive) {
          e.preventDefault()
          onActivate?.(p.id)
        }
      }}
    >
      {editing ? (
        <input
          className="li-esp-box-input"
          type="text"
          autoFocus
          value={editingValue ?? ''}
          placeholder={caption}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onEditingChange?.(p.id, e.target.value)}
          onBlur={() => onEditingCommit?.(p.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              onEditingCommit?.(p.id)
            }
          }}
        />
      ) : (
        <span className="li-esp-box-body">
          {image ? (
            <img src={image} alt={`${caption}, applied`} className="li-esp-box-value--img" />
          ) : shown ? (
            <span className={`li-esp-box-value${isSig ? ' li-esp-box-value--sig' : ''}`}>
              {shown}
            </span>
          ) : (
            <>
              <span className="li-esp-box-ico" aria-hidden="true">
                {glyph.icon}
              </span>
              <span className="li-esp-box-label">
                {caption}
                {p.type === 'date' ? ' (auto)' : ''}
                {p.required ? <em className="li-esp-box-req">*</em> : null}
              </span>
            </>
          )}
        </span>
      )}
      {isSig && !image && <span className="li-esp-box-rule" aria-hidden="true" />}
      {guided?.complete && !guided.auto && (
        <span className="li-esp-box-check" aria-hidden="true">
          <CheckIcon size={10} />
        </span>
      )}
      {readOnly && selected && interactive && !guided?.complete && (
        <span className="li-esp-box-tag">{guidedActionLabel(p.type)}</span>
      )}
      {!readOnly && selected && (
        <>
          <button
            type="button"
            className="li-esp-box-del"
            aria-label={`Delete ${caption} field`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(p.id)
            }}
          >
            <XIcon size={11} />
          </button>
          {HANDLES.map((h) => (
            <span
              key={h}
              className={`li-esp-handle li-esp-handle--${h}`}
              onPointerDown={(e) => beginGesture(e, h)}
              onPointerMove={moveGesture}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            />
          ))}
        </>
      )}
    </div>
  )
}
