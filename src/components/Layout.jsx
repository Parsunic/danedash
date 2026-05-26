import Sidebar from './Sidebar.jsx'
import BottomNav from './BottomNav.jsx'

export default function Layout({ children }) {
  return (
    <>
      <Sidebar />
      <main className="main-content">
        <div className="page-wrap">
          {children}
        </div>
      </main>
      <BottomNav />
    </>
  )
}
