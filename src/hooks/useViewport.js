import { useCallback, useEffect, useRef, useState } from 'react'

// Container-measured viewport tiers for the dynamic card grid.
// Width is read from the OBSERVED CONTAINER (accounts for sidebar + page-wrap cap),
// not the window; height tiers come from the window. Grid-scoped — do NOT retrofit
// modules' frozen matchMedia constants with this.
const DEBOUNCE_MS = 150

const COL_META = {
  2: { bp: 'mobile', rowUnit: 132 },
  3: { bp: 'tablet', rowUnit: 142 },
  4: { bp: 'desktop', rowUnit: 150 },
}

function widthToCols(w) {
  if (w < 560) return 2
  if (w < 980) return 3
  return 4
}

function heightToTier(h) {
  if (h < 700) return 'short'
  if (h >= 900) return 'tall'
  return 'normal'
}

export default function useViewport() {
  const nodeRef = useRef(null)
  const observerRef = useRef(null)
  const timerRef = useRef(null)
  const [tier, setTier] = useState(() => ({
    cols: widthToCols(window.innerWidth),
    vhTier: heightToTier(window.innerHeight),
  }))
  const tierRef = useRef(tier)
  tierRef.current = tier

  const measure = useCallback(() => {
    const w = nodeRef.current ? nodeRef.current.clientWidth : window.innerWidth
    const cols = widthToCols(w)
    const vhTier = heightToTier(window.innerHeight)
    // Only commit state when a tier actually changes — raw pixel churn never re-renders.
    if (cols !== tierRef.current.cols || vhTier !== tierRef.current.vhTier) {
      setTier({ cols, vhTier })
    }
  }, [])

  const scheduleMeasure = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(measure, DEBOUNCE_MS)
  }, [measure])

  // Callback ref: attach to the grid container element.
  const containerRef = useCallback(node => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    nodeRef.current = node
    if (node) {
      if (typeof ResizeObserver !== 'undefined') {
        observerRef.current = new ResizeObserver(scheduleMeasure)
        observerRef.current.observe(node)
      }
      measure() // immediate — container width differs from window width
    }
  }, [measure, scheduleMeasure])

  useEffect(() => {
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('orientationchange', scheduleMeasure)
    return () => {
      clearTimeout(timerRef.current)
      if (observerRef.current) observerRef.current.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('orientationchange', scheduleMeasure)
    }
  }, [scheduleMeasure])

  const meta = COL_META[tier.cols]
  return { containerRef, cols: tier.cols, bp: meta.bp, rowUnit: meta.rowUnit, vhTier: tier.vhTier }
}
