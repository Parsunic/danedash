import { NavLink } from 'react-router-dom'
import { modules } from '../App.jsx'

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Dane's Dashboard</div>
      <nav className="sidebar-nav">
        {modules.map(({ path, label, icon }) => (
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
