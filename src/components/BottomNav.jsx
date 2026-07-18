import { NavLink } from 'react-router-dom'
import { useNavModules } from '../lib/navOrder.js'

export default function BottomNav() {
  // Bottom bar shows only the visible (non-hidden) modules, in customized order.
  const { mobileVisible } = useNavModules()
  return (
    <nav className="bottom-tabbar">
      {mobileVisible.map(({ path, label, icon }) => (
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
