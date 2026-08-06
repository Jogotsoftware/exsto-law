'use client'

// RAIL-FOLLOWUPS-1 — rail open/pin state, lifted out of the rail.
//
// The founder moved the brand lockup OUT of the rail and INTO the top bar: the
// twinkle mark sits at the bar's left edge, over the rail's icon column, and
// slides along the bar into the tail of the wordmark as the rail expands. So
// two siblings — the bar and the rail — now need the same "is the rail open"
// answer, and the pin button lives in the bar while the hover target is the
// rail. That is exactly what a small context is for; the alternative (the rail
// stamping a class on the shell root) would put DOM mutation in the middle of
// a React tree for no gain.
//
// Both shells use this: AttorneyShell wraps the attorney console, the portal
// page wraps its own shell. The only difference is `storageKey`, so attorney
// and portal pin states never collide.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export interface RailShell {
  /** Rail is showing labels — pinned, hovered, or holding open for a popover. */
  expanded: boolean
  pinned: boolean
  togglePin: () => void
  /** Hover-expand is pointer-media gated; touch devices never hover-open. */
  onRailEnter: () => void
  onRailLeave: () => void
  /** A rail popover (the account menu) holds the rail open past pointer-leave. */
  setHoldOpen: (v: boolean) => void
  /** Width the in-flow spacer should hold: 256 only when pinned on a wide viewport. */
  spacerWidth: number
  railWidth: number
}

const FALLBACK: RailShell = {
  expanded: false,
  pinned: false,
  togglePin: () => {},
  onRailEnter: () => {},
  onRailLeave: () => {},
  setHoldOpen: () => {},
  spacerWidth: 58,
  railWidth: 58,
}

const RailShellContext = createContext<RailShell>(FALLBACK)

export function useRailShell(): RailShell {
  return useContext(RailShellContext)
}

export function RailShellProvider({
  storageKey,
  children,
}: {
  storageKey: string
  children: ReactNode
}): React.JSX.Element {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [holdOpen, setHoldOpen] = useState(false)
  const [canHover, setCanHover] = useState(true)
  const [isNarrow, setIsNarrow] = useState(false)

  // Restore the pinned state persisted across sessions.
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey)
      if (v != null) setPinned(v === '1')
    } catch {
      /* private mode / storage blocked — default to unpinned */
    }
  }, [storageKey])

  // Hover-expand is pointer-media-gated; the spacer stays at icon width on
  // narrow viewports. Track both with matchMedia.
  useEffect(() => {
    const hoverMq = window.matchMedia('(hover: hover)')
    const narrowMq = window.matchMedia('(max-width: 859px)')
    const sync = (): void => {
      setCanHover(hoverMq.matches)
      setIsNarrow(narrowMq.matches)
    }
    sync()
    hoverMq.addEventListener('change', sync)
    narrowMq.addEventListener('change', sync)
    return () => {
      hoverMq.removeEventListener('change', sync)
      narrowMq.removeEventListener('change', sync)
    }
  }, [])

  const togglePin = useCallback(() => {
    setPinned((p) => {
      const next = !p
      try {
        localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        /* storage blocked — pin state is best-effort */
      }
      return next
    })
  }, [storageKey])

  const onRailEnter = useCallback(() => {
    if (canHover) setHovered(true)
  }, [canHover])
  const onRailLeave = useCallback(() => setHovered(false), [])

  const value = useMemo<RailShell>(() => {
    const expanded = pinned || hovered || holdOpen
    return {
      expanded,
      pinned,
      togglePin,
      onRailEnter,
      onRailLeave,
      setHoldOpen,
      spacerWidth: pinned && !isNarrow ? 256 : 58,
      railWidth: expanded ? 256 : 58,
    }
  }, [pinned, hovered, holdOpen, isNarrow, togglePin, onRailEnter, onRailLeave])

  return <RailShellContext.Provider value={value}>{children}</RailShellContext.Provider>
}
