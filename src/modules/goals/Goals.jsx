import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import HabitsSection from './HabitsSection.jsx'
import GoalsProjectsSection from './GoalsProjectsSection.jsx'
import AIInsightsCard from './components/AIInsightsCard.jsx'
import Todo from '../todo/Todo.jsx'

function FlipIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="goals-flip-icon">
      <path d="M16 3l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M20 7H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 21l-4-4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

export default function Goals() {
  const location = useLocation()
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('view') === 'tasks' ? 'tasks' : 'goals'
  })
  const [animState, setAnimState] = useState('')
  const [isFlipping, setIsFlipping] = useState(false)

  function flip() {
    if (isFlipping) return
    setIsFlipping(true)
    setAnimState('goals-flip-exit')
    setTimeout(() => {
      setView(v => v === 'goals' ? 'tasks' : 'goals')
      setAnimState('goals-flip-enter')
      setTimeout(() => {
        setAnimState('')
        setIsFlipping(false)
      }, 320)
    }, 320)
  }

  return (
    <div className="section">
      <BackgroundBlob page="goals" />
      <div className="goals-page-header">
        <button
          className={`goals-title-btn${isFlipping ? ' is-flipping' : ''}`}
          onClick={flip}
          title={view === 'goals' ? 'Switch to Tasks' : 'Switch to Goals'}
        >
          <span className="section-title">{view === 'goals' ? 'Goals' : 'Tasks'}</span>
          <FlipIcon />
        </button>
      </div>

      <div className={`goals-flip-content${animState ? ' ' + animState : ''}`}>
        {view === 'goals' ? (
          <>
            <div className="goals-top-grid">
              <div>
                <div className="goals-section-label">AI Insights</div>
                <div className="ai-insights-micro-copy">One honest read on how you're actually doing.</div>
                <AIInsightsCard />
              </div>
              <div>
                <HabitsSection />
              </div>
            </div>
            <GoalsProjectsSection />
          </>
        ) : (
          <Todo embedded />
        )}
      </div>
    </div>
  )
}
