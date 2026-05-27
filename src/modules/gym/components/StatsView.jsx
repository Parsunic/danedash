import { useState, useCallback, useEffect } from 'react'
import { storeGet } from '../../../lib/storage.js'

export default function StatsView() {
  const [search, setSearch] = useState('')
  const [hist, setHist] = useState(() => storeGet('gym_exercise_history') || {})

  const reload = useCallback(() => setHist(storeGet('gym_exercise_history') || {}), [])

  useEffect(() => {
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [reload])

  const allExercises = Object.keys(hist)
  const filtered = search.trim()
    ? allExercises.filter(n => n.toLowerCase().includes(search.toLowerCase()))
    : allExercises

  return (
    <div className="gym-stats-view">
      <div className="gym-stats-search-wrap">
        <span className="gym-stats-search-icon">⌕</span>
        <input
          className="gym-stats-search"
          placeholder="Search exercises…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="gym-stats-search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="gym-placeholder">
          <div className="gym-placeholder-icon">📊</div>
          <div className="gym-placeholder-title">{search ? 'No matching exercises' : 'No data yet'}</div>
          <div className="gym-placeholder-sub">
            {search ? 'Try a different search.' : 'Log workouts on mobile to see stats here.'}
          </div>
        </div>
      ) : (
        <div className="gym-stats-exercise-list">
          {filtered.map(name => {
            const data = hist[name]
            const sessions = data?.sessions || []
            const pr = data?.allTimePR
            const last = sessions[sessions.length - 1]
            return (
              <div key={name} className="gym-stats-exercise-card">
                <div className="gym-stats-ex-header">
                  <div className="gym-stats-ex-name">{name}</div>
                  <div className="gym-stats-ex-badges">
                    {pr != null && <span className="gym-stats-ex-pr">PR {pr} lbs</span>}
                    <span className="gym-stats-ex-count">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                {last && (
                  <div className="gym-stats-ex-last">
                    Last: {last.date} · {last.weight}×{last.reps} @ RPE {last.rpe}
                  </div>
                )}
                <div className="gym-stats-chart-placeholder">
                  <span>Progress graph — coming soon</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
