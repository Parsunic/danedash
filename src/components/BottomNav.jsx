import { NavLink } from 'react-router-dom'
import { modules } from '../App.jsx'

export default function BottomNav() {
  return (
    <nav className="bottom-tabbar">
      {modules.map(({ path, label, icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          className={({ isActive }) => `tab-btn${isActive ? ' active' : ''}`}
          aria-label={label}
        >
          <span className="tab-icon">{icon}</span>
        </NavLink>
      ))}
    </nav>
  )
}
