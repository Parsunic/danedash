import { useState } from 'react'
import Dashboard from './Dashboard.jsx'
import DashboardCards from './DashboardCards.jsx'

// Card grid is the default. localStorage['cards_v2'] = '0' is the instant
// rollback switch to the untouched original Dashboard. Read once per mount.
export default function DashboardSwitch() {
  const [useCards] = useState(() => {
    try { return localStorage.getItem('cards_v2') !== '0' } catch { return true }
  })
  return useCards ? <DashboardCards /> : <Dashboard />
}
