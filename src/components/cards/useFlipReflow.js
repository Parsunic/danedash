import { useLayoutEffect, useRef } from 'react'

// FLIP: after an order/size/cols change, glide each .dc-item from its previous
// grid slot to its new one. Positions come from offsetLeft/offsetTop (layout
// coords — in-flight transforms never feed back into the measurement).
export default function useFlipReflow(containerRef, deps) {
  const positionsRef = useRef(new Map())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const items = container.querySelectorAll('.dc-item')
    const prev = positionsRef.current
    const next = new Map()
    items.forEach(el => {
      next.set(el.dataset.id, { left: el.offsetLeft, top: el.offsetTop })
    })
    positionsRef.current = next

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let moved = false
    items.forEach(el => {
      const from = prev.get(el.dataset.id)
      if (!from) return
      const to = next.get(el.dataset.id)
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (!dx && !dy) return
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      moved = true
    })
    if (!moved) return

    void container.offsetHeight // force reflow so the inverted transform paints

    items.forEach(el => {
      if (!el.style.transform) return
      el.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)'
      el.style.transform = ''
    })
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
