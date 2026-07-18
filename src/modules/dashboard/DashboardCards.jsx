import { useState, useEffect } from 'react'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import CardGrid from '../../components/cards/CardGrid.jsx'
import { useUIEdit } from '../../contexts/UIEditContext.jsx'
import GoalTickerStrip from './widgets/GoalTickerStrip.jsx'
import { DASH_WIDGETS, DEFAULT_DASH_ORDER } from './widgets/registry.jsx'

// Card-grid dashboard (cards_v2). Ticker stays a fixed strip above the grid.
// editing/layoutMode come from UIEditContext (safe inert defaults until the
// provider mounts in P3). Dev/test hook: dispatching a window CustomEvent
// 'dc-toggle-edit' toggles a local editing override (OR-ed with the context) —
// how tests/orchestration enter edit mode before the Settings UI exists.
export default function DashboardCards() {
  const { editing: ctxEditing, layoutMode, setLayoutMode } = useUIEdit()
  const [devEditing, setDevEditing] = useState(false)

  useEffect(() => {
    const onToggle = () => setDevEditing(v => !v)
    window.addEventListener('dc-toggle-edit', onToggle)
    return () => window.removeEventListener('dc-toggle-edit', onToggle)
  }, [])

  const editing = ctxEditing || devEditing

  return (
    <>
      <BackgroundBlob page="dashboard" />
      <GoalTickerStrip />
      <CardGrid
        area="dashboard"
        registry={DASH_WIDGETS}
        defaultOrder={DEFAULT_DASH_ORDER}
        editing={editing}
        mode={layoutMode}
        onAdoptAuto={() => setLayoutMode('manual')}
      />
    </>
  )
}
