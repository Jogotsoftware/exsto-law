'use client'

import { useEffect, useRef } from 'react'

// Zoom-to-fit for the WYSIWYG template page. The page is a FIXED-width letter
// sheet; this measures the scroll container and sets `--tpl-zoom` so the whole
// page (text + margins + paper together) scales down to fit the column — exactly
// how Word/Google-Docs render a page at a fit zoom. Without it the page was
// `width:100%` with a fixed font, so in the narrow editor|preview split the text
// looked oversized and long lines ran off the page (the beta complaint).
//
// We never scale ABOVE 1 (don't upscale past the true size). CSS `zoom` is used
// (not transform: scale) because it keeps the caret and click coordinates correct
// inside the contenteditable.
const PAGE_WIDTH_PX = 7.75 * 96 // matches --tpl-page-width (7.75in) at 96dpi

export function useFitToWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const style = getComputedStyle(el)
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const avail = el.clientWidth - padX
      const scale = avail > 0 ? Math.min(1, avail / PAGE_WIDTH_PX) : 1
      el.style.setProperty('--tpl-zoom', String(Math.round(scale * 1000) / 1000))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return ref
}
