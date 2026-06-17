import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import Todo from '../todo/Todo.jsx'
import HabitsSection from './HabitsSection.jsx'
import GoalsProjectsSection from './GoalsProjectsSection.jsx'
import AIInsightsCard from './components/AIInsightsCard.jsx'

export default function Goals() {
  return (
    <div className="section">
      <BackgroundBlob page="goals" />
      <div className="section-title">Goals</div>

      <div className="goals-section-label">AI Insights</div>
      <div className="ai-insights-micro-copy">One honest read on how you're actually doing.</div>
      <AIInsightsCard />

      <HabitsSection />

      <GoalsProjectsSection />

      <div className="goals-section-label">Tasks</div>
      <Todo embedded />
    </div>
  )
}
