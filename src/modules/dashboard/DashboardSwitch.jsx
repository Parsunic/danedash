import { useState } from 'react'
import Dashboard from './Dashboard.jsx'
import DashboardCards from './DashboardCards.jsx'

// Feature-flag switch: localStorage['cards_v2'] === '1' → new card grid,
// anything else → the untouched original Dashboard. Read once per mount.
export default function DashboardSwitch() {
  const [useCards] = useState(() => {
    try { return localStorage.getItem('cards_v2') === '1' } catch { return false }
  })
  return useCards ? <DashboardCards /> : <Dashboard />
}
