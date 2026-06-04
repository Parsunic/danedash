import { useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './modules/dashboard/index.jsx'
import Todo from './modules/todo/index.jsx'
import Journal from './modules/journal/index.jsx'
import Gym from './modules/gym/index.jsx'
import Calendar from './modules/calendar/index.jsx'
import Health from './modules/health/index.jsx'
import { SyncProvider } from './contexts/SyncContext.jsx'
import { handleOAuthCallback, syncOnLoad } from './modules/calendar/googleSync.js'
import { handleFitbitCallback, syncTodayIfStale, loadTokensFromSupabase } from './modules/health/fitbitSync.js'

function OAuthCallbackHandler() {
  const navigate = useNavigate()
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('code')) {
      // Disambiguate: Fitbit stores its state key before redirecting
      if (localStorage.getItem('fitbit_oauth_state')) {
        handleFitbitCallback().then(success => {
          navigate(success ? '/health' : '/', { replace: true })
          if (success) syncTodayIfStale()
        })
      } else {
        handleOAuthCallback().then(success => {
          console.log('[GCal] OAuth callback result:', success)
          navigate(success ? '/calendar' : '/', { replace: true })
          if (success) syncOnLoad()
        })
      }
    } else {
      syncOnLoad()
      loadTokensFromSupabase()
    }
  }, [navigate])
  return null
}

export const modules = [
  {
    path: '/',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="1" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.85" />
        <rect x="10" y="1" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.85" />
        <rect x="1" y="10" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.85" />
        <rect x="10" y="10" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.85" />
      </svg>
    ),
    component: Dashboard,
  },
  {
    path: '/todo',
    label: 'To-Do',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 4.5h12M3 9h8M3 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12.5 11.5l1.5 1.5 2-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    component: Todo,
  },
  {
    path: '/journal',
    label: 'Journal',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="2" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M6 6h6M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    component: Journal,
  },
  {
    path: '/gym',
    label: 'Gym',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="7" width="2.5" height="4" rx="1" fill="currentColor" />
        <rect x="14.5" y="7" width="2.5" height="4" rx="1" fill="currentColor" />
        <rect x="3.5" y="5.5" width="2" height="7" rx="1" fill="currentColor" />
        <rect x="12.5" y="5.5" width="2" height="7" rx="1" fill="currentColor" />
        <rect x="5.5" y="8" width="7" height="2" rx="1" fill="currentColor" />
      </svg>
    ),
    component: Gym,
  },
  {
    path: '/calendar',
    label: 'Calendar',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M2 7h14" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1v3M12 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="5" y="10" width="2.5" height="2.5" rx="0.5" fill="currentColor" opacity="0.7" />
        <rect x="10.5" y="10" width="2.5" height="2.5" rx="0.5" fill="currentColor" opacity="0.7" />
      </svg>
    ),
    component: Calendar,
  },
]

export default function App() {
  return (
    <SyncProvider>
      <OAuthCallbackHandler />
      <Layout>
        <Routes>
          {modules.map(({ path, component: Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
        </Routes>
      </Layout>
    </SyncProvider>
  )
}
