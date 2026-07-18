import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useViewport from '../../hooks/useViewport.js'
import {
  bpBucket, clampSize, loadLayout, saveAreaLayout, setLayoutMode,
} from '../../lib/cards/layoutStore.js'
import { computeAutoLayout } from '../../lib/cards/autoLayout.js'
import CardShell from './CardShell.jsx'
import WidgetTray from './WidgetTray.jsx'
import useFlipReflow from './useFlipReflow.js'
import useCardDrag from './useCardDrag.js'

// Card-grid renderer. One flat parent; children are CardShells with STABLE
// widget-id keys — reorder must never remount (size is a class, never a key).
// Content inertness in edit mode comes from CSS (.dc-content pointer-events),
// not from JS tree changes.
export default function CardGrid({ area, registry, defaultOrder, editing, mode, onAdoptAuto }) {
  const { containerRef, cols, bp, rowUnit, vhTier } = useViewport()
  const bucket = bpBucket(cols)

  const [layout, setLayout] = useState(() => loadLayout(area, registry, bucket, defaultOrder))
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const pendingReloadRef = useRef(false)

  const reloadLayout = useCallback(() => {
    const next = loadLayout(area, registry, bucket, defaultOrder)
    setLayout(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [area, registry, bucket, defaultOrder])

  // Breakpoint bucket flips (phone rotate, window resize across 560px) → reload.
  useEffect(() => { reloadLayout() }, [reloadLayout])

  // Manual-mode drag: live reorders update state only; ONE save on drop.
  const handleReorder = useCallback(next => {
    setLayout(prev => ({ ...prev, order: next }))
  }, [])

  const handleCommit = useCallback(finalOrder => {
    const current = { ...layoutRef.current, order: finalOrder }
    setLayout(current)
    saveAreaLayout(area, bucket, current)
    if (pendingReloadRef.current) {
      pendingReloadRef.current = false
      reloadLayout()
    }
  }, [area, bucket, reloadLayout])

  const gridElRef = useRef(null)
  const setGridRef = useCallback(node => {
    gridElRef.current = node
    containerRef(node)
  }, [containerRef])

  const dragActiveRef = useCardDrag({
    containerRef: gridElRef,
    order: layout.order,
    enabled: editing && mode === 'manual',
    onReorder: handleReorder,
    onCommit: handleCommit,
  })

  // Remote sync landed: re-read, unless a drag is mid-flight (apply on drop).
  useEffect(() => {
    const onSyncApplied = () => {
      if (dragActiveRef.current) {
        pendingReloadRef.current = true
        return
      }
      reloadLayout()
    }
    window.addEventListener('sync-applied', onSyncApplied)
    return () => window.removeEventListener('sync-applied', onSyncApplied)
  }, [reloadLayout, dragActiveRef])

  const autoComputed = useMemo(
    () => (mode === 'auto' ? computeAutoLayout(registry, layout.order, cols, vhTier) : null),
    [mode, registry, layout.order, cols, vhTier]
  )

  const effOrder = autoComputed ? autoComputed.order : layout.order
  const effSizes = autoComputed ? autoComputed.sizes : layout.sizes

  const orderKey = effOrder.join('|')
  const sizesKey = effOrder.map(id => effSizes[id]).join('|')
  useFlipReflow(gridElRef, [orderKey, sizesKey, cols])

  const handleHide = useCallback(id => {
    const prev = layoutRef.current
    const next = {
      ...prev,
      order: prev.order.filter(x => x !== id),
      hidden: prev.hidden.includes(id) ? prev.hidden : [...prev.hidden, id],
    }
    setLayout(next)
    saveAreaLayout(area, bucket, next)
  }, [area, bucket])

  // Tray re-add: visible at the end, back at its default size.
  const handleShow = useCallback(id => {
    const entry = registry[id]
    if (!entry) return
    const prev = layoutRef.current
    const next = {
      ...prev,
      order: prev.order.includes(id) ? prev.order : [...prev.order, id],
      sizes: { ...prev.sizes, [id]: clampSize(entry.defaultSize, entry.sizes, cols) },
      hidden: prev.hidden.filter(x => x !== id),
    }
    setLayout(next)
    saveAreaLayout(area, bucket, next)
  }, [area, bucket, cols, registry])

  const handleCycleSize = useCallback(id => {
    const entry = registry[id]
    if (!entry || !Array.isArray(entry.sizes) || entry.sizes.length < 2) return
    const prev = layoutRef.current
    const currentSize = clampSize(prev.sizes[id] || entry.defaultSize, entry.sizes, cols)
    const nextSize = entry.sizes[(entry.sizes.indexOf(currentSize) + 1) % entry.sizes.length]
    const next = { ...prev, sizes: { ...prev.sizes, [id]: nextSize } }
    setLayout(next)
    saveAreaLayout(area, bucket, next)
    // Recharts re-measures on window resize — fire after the new spans paint.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }, [area, bucket, cols, registry])

  // Copy the computed auto arrangement into this breakpoint's manual bucket,
  // then flip the global mode to manual (explicit user gesture).
  const handleAdoptAuto = useCallback(() => {
    const computed = computeAutoLayout(registry, layoutRef.current.order, cols, vhTier)
    const adopted = { order: computed.order, sizes: computed.sizes, hidden: layoutRef.current.hidden }
    setLayout(adopted)
    saveAreaLayout(area, bucket, adopted)
    if (onAdoptAuto) onAdoptAuto()
    else setLayoutMode('manual')
  }, [area, bucket, cols, vhTier, registry, onAdoptAuto])

  const isAuto = mode === 'auto'

  return (
    <>
      {editing && isAuto && (
        <div className="dc-auto-hint">
          <span>Auto layout — sizes chosen for your screen.</span>
          <button className="btn-ghost" onClick={handleAdoptAuto}>Customize</button>
        </div>
      )}
      <div
        className="dc-grid"
        ref={setGridRef}
        style={{ '--dc-cols': cols, '--dc-row': rowUnit + 'px' }}
        data-cols={cols}
        data-editing={editing || undefined}
      >
        {effOrder.map(id => {
          const entry = registry[id]
          if (!entry) return null
          const Widget = entry.component
          const size = clampSize(effSizes[id] || entry.defaultSize, entry.sizes, cols)
          return (
            <CardShell
              key={id}
              id={id}
              size={size}
              editing={editing}
              chromeless={entry.chromeless}
              sizes={entry.sizes}
              onHide={handleHide}
              onCycleSize={isAuto ? undefined : handleCycleSize}
            >
              <Widget size={size} bp={bp} />
            </CardShell>
          )
        })}
      </div>
      {editing && (
        <WidgetTray registry={registry} hiddenIds={layout.hidden} onAdd={handleShow} />
      )}
    </>
  )
}
