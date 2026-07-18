import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { useFlip, FlipTitle } from '../../components/FlipSwitch.jsx'
import Todo from '../todo/Todo.jsx'
import CardGrid from '../../components/cards/CardGrid.jsx'
import { useUIEdit } from '../../contexts/UIEditContext.jsx'
import { GOALS_REGISTRY, GOALS_ORDER } from './goalsCardRegistry.jsx'

function GoalsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}

function TasksIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 7h7M13 17h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function Goals() {
  const location = useLocation()
  const initialTasks = new URLSearchParams(location.search).get('view') === 'tasks'
  const { flipped, animState, isFlipping, flip } = useFlip(initialTasks)
  const view = flipped ? 'tasks' : 'goals'

  return (
    <div className="section">
      <BackgroundBlob page="goals" />
      <div className="goals-page-header">
        <FlipTitle
          icon={view === 'goals' ? <GoalsIcon /> : <TasksIcon />}
          label={view === 'goals' ? 'Goals' : 'Tasks'}
          isFlipping={isFlipping}
          onClick={() => flip()}
          title={view === 'goals' ? 'Switch to Tasks' : 'Switch to Goals'}
        />
      </div>

      <div className={`flip-content${animState ? ' ' + animState : ''}`}>
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
