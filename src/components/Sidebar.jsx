import { NavLink } from 'react-router-dom'
import { useNavModules } from '../lib/navOrder.js'

export default function Sidebar() {
  // Sidebar shows ALL modules (never filtered) — just in the customized order.
  const { ordered } = useNavModules()
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">
          <span className="logo-chevron">&gt;</span>
          <span className="logo-dane">dane</span>
          <span className="logo-dash">dash</span>
          <span className="logo-cursor" />
        </span>
      </div>
      <nav className="sidebar-nav">
        {ordered.map(({ path, label, icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
