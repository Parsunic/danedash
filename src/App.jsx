import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './modules/dashboard/index.jsx'
import Todo from './modules/todo/index.jsx'
import Gym from './modules/gym/index.jsx'

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
]

export default function App() {
  return (
    <Layout>
      <Routes>
        {modules.map(({ path, component: Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
      </Routes>
    </Layout>
  )
}
