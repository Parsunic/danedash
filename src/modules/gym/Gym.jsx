import { useState, useCallback, useRef, useEffect } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { getActiveDateString } from '../../lib/dateHelpers.js'
import { gymUUID, calcE1RM, parseRepRange } from './gymUtils.js'
import { lookupMusclesBatch } from '../../lib/muscleUtils.js'
import { runMuscleMigration } from '../../lib/muscleMigration.js'
import TemplatesView from './components/TemplatesView.jsx'
import PlannerView from './components/PlannerView.jsx'
import AICoachView from './components/AICoachView.jsx'
import LogView from './components/LogView.jsx'
import HistoryView from './components/HistoryView.jsx'
import RestTimer from './components/RestTimer.jsx'
import StatsView from './components/StatsView.jsx'

const OVERLAY_TABS = ['templates', 'ai-coach', 'history', 'stats']
const OVERLAY_LABELS = { templates: 'Templates', 'ai-coach': 'AI Coach', history: 'History', stats: 'Stats', log: 'Log' }

const INIT_REST = { visible: false, remaining: 0, total: 0, paused: false, lastSecs: 90 }

const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

export default function Gym() {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayTab, setOverlayTab] = useState('templates')
  const [plannerWeekOffset, setPlannerWeekOffset] = useState(0)
  const [activeSession, setActiveSession] = useState(null)
  const [restState, setRestState] = useState(INIT_REST)
  const restIntervalRef = useRef(null)

  // ── REST TIMER ──
  const startRestTimer = useCallback(secs => {
    clearInterval(restIntervalRef.current)
    setRestState({ visible: true, remaining: secs, total: secs, paused: false, lastSecs: secs })
    restIntervalRef.current = setInterval(() => {
      setRestState(prev => {
        if (prev.paused || prev.remaining <= 0) return prev
        const next = prev.remaining - 1
        if (next <= 0) {
          clearInterval(restIntervalRef.current)
          if (navigator.vibrate) navigator.vibrate([200, 100, 200])
          try {
            const ac = new (window.AudioContext || window.webkitAudioContext)()
            const osc = ac.createOscillator(), gain = ac.createGain()
            osc.connect(gain); gain.connect(ac.destination)
            osc.frequency.setValueAtTime(880, ac.currentTime)
            osc.frequency.setValueAtTime(660, ac.currentTime + 0.15)
            gain.gain.setValueAtTime(0.20, ac.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.7)
            osc.start(); osc.stop(ac.currentTime + 0.7)
          } catch (e) {}
        }
        return { ...prev, remaining: next }
      })
    }, 1000)
  }, [])

  useEffect(() => () => clearInterval(restIntervalRef.current), [])
  useEffect(() => { runMuscleMigration().catch(() => {}) }, [])

  // ── WORKOUT CONTROL ──
  const startWorkout = useCallback((exList, plannedId, name) => {
    const session = {
      id: gymUUID(), plannedId: plannedId || null,
      name: name || 'Workout', date: getActiveDateString(), startedAt: Date.now(),
      exercises: exList.filter(ex => ex.name).map(ex => ({
        name: ex.name, repRange: ex.repRange || '8-10',
        notes: ex.notes || '', targetSets: ex.sets || 3, sets: [],
      })),
    }
    setActiveSession(session)
    setOverlayTab('log')
    setOverlayOpen(true)
  }, [])

  const handleLogSet = useCallback((ei, weight, reps, rpe) => {
    setActiveSession(prev => {
      if (!prev) return prev
      const hist = storeGet('gym_exercise_history') || {}
      const ex = prev.exercises[ei]
      const isPR = weight > (hist[ex.name]?.allTimePR || 0)
      const e1rm = calcE1RM(weight, reps)
      const updated = { ...prev }
      updated.exercises = prev.exercises.map((e, i) =>
        i === ei ? { ...e, sets: [...e.sets, { weight, reps, rpe, isPR, e1rm }] } : e
      )
      return updated
    })
    startRestTimer(restState.lastSecs)
  }, [startRestTimer, restState.lastSecs])

  const handleFinishWorkout = useCallback(async () => {
    if (!activeSession) return
    if (!activeSession.exercises.some(ex => ex.sets.length) && !confirm('No sets logged. Finish anyway?')) return

    const hist = storeGet('gym_exercise_history') || {}
    activeSession.exercises.forEach(ex => {
      if (!ex.sets.length) return
      const { hi } = parseRepRange(ex.repRange)
      const best = ex.sets.reduce((a, b) => (b.e1rm || 0) > (a.e1rm || 0) ? b : a)
      const avgRpe = parseFloat((ex.sets.reduce((s, x) => s + x.rpe, 0) / ex.sets.length).toFixed(1))
      const allHitTop = ex.sets.every(s => s.reps >= hi)
      if (!hist[ex.name]) hist[ex.name] = { sessions: [], allTimePR: 0 }
      const exH = hist[ex.name]
      ex.sets.forEach(s => { if (s.weight > (exH.allTimePR || 0)) exH.allTimePR = s.weight })
      exH.sessions = exH.sessions || []
      exH.sessions.push({ date: activeSession.date, weight: best.weight, reps: best.reps, rpe: avgRpe, e1rm: best.e1rm, allHitTop })
      if (exH.sessions.length > 20) exH.sessions = exH.sessions.slice(-20)
    })
    storeSet('gym_exercise_history', hist)

    const exNames = activeSession.exercises.map(ex => ex.name).filter(Boolean)
    const muscleMap = await lookupMusclesBatch(exNames).catch(() => ({}))

    const logs = storeGet('gym_workout_logs') || []
    logs.push({
      id: activeSession.id, date: activeSession.date, name: activeSession.name,
      plannedId: activeSession.plannedId, startedAt: activeSession.startedAt,
      completedAt: new Date().toISOString(), duration: Date.now() - activeSession.startedAt,
      exercises: activeSession.exercises.map(ex => {
        const muscle = muscleMap[ex.name] ?? 'other'
        return {
          name: ex.name,
          primary_muscle: muscle,
          e1rm: ex.sets.length ? Math.max(...ex.sets.map(s => s.e1rm || 0)) : null,
          sets: ex.sets.map(s => ({ ...s, primary_muscle: muscle })),
        }
      }),
    })
    if (logs.length > 200) logs.splice(0, logs.length - 200)
    storeSet('gym_workout_logs', logs)

    if (activeSession.plannedId) {
      const planned = storeGet('gym_planned') || []
      const pi = planned.findIndex(p => p.id === activeSession.plannedId)
      if (pi >= 0) { planned[pi].status = 'completed'; storeSet('gym_planned', planned) }
    }

    const sName = activeSession.name
    setActiveSession(null)
    setActiveSession({ __done: true, name: sName })
    setTimeout(() => {
      setActiveSession(null)
      setOverlayTab('history')
    }, 1200)
  }, [activeSession])

  const handleAIPlanLoaded = useCallback(weekOffset => {
    setPlannerWeekOffset(weekOffset)
    setOverlayOpen(false)
  }, [])

  const visibleTabs = activeSession ? ['log', ...OVERLAY_TABS] : OVERLAY_TABS

  const logContent = activeSession?.__done ? (
    <div className="gym-log-idle">
      <div className="gym-log-idle-title">✓ Workout Complete!</div>
      <div className="gym-log-idle-sub">{activeSession.name} saved to history.</div>
    </div>
  ) : (
    <LogView
      activeSession={activeSession}
      onLogSet={handleLogSet}
      onFinish={handleFinishWorkout}
      onStartWorkout={startWorkout}
    />
  )

  return (
    <>
      <BackgroundBlob page="gym" />

      <div className={`gym-page-content${overlayOpen && isDesktop ? ' overlay-open' : ''}`}>
        <h1 className="dash-title">Gym</h1>
        <PlannerView
          weekOffset={plannerWeekOffset}
          onWeekOffsetChange={setPlannerWeekOffset}
          onStartWorkout={startWorkout}
          desktopMode={isDesktop}
        />
      </div>

      {/* Persistent handle */}
      <button
        className={`gym-overlay-handle${overlayOpen ? ' open' : ''}`}
        onClick={() => setOverlayOpen(o => !o)}
        aria-label="Toggle panel"
      >
        <span className="gym-overlay-chevron">{overlayOpen ? '‹' : '›'}</span>
      </button>

      {/* Blur backdrop — click outside to close */}
      <div
        className={`gym-overlay-backdrop${overlayOpen ? ' visible' : ''}`}
        onClick={() => setOverlayOpen(false)}
      />

      {/* Slide-in overlay panel */}
      <div className={`gym-overlay-panel${overlayOpen ? ' open' : ''}`}>
        <div className="gym-overlay-header">
          <div className="gym-overlay-tabs">
            {visibleTabs.map(tab => (
              <button
                key={tab}
                className={`gym-overlay-tab-btn${overlayTab === tab ? ' active' : ''}`}
                onClick={() => setOverlayTab(tab)}
              >
                {OVERLAY_LABELS[tab]}
              </button>
            ))}
          </div>
          <button className="gym-overlay-close" onClick={() => setOverlayOpen(false)}>×</button>
        </div>

        <div className="gym-overlay-content">
          {overlayTab === 'templates' && <TemplatesView />}
          {overlayTab === 'ai-coach' && <AICoachView onPlanLoaded={handleAIPlanLoaded} />}
          {overlayTab === 'history' && <HistoryView />}
          {overlayTab === 'stats' && <StatsView />}
          {overlayTab === 'log' && logContent}
        </div>
      </div>

      <RestTimer
        restState={restState}
        onDismiss={() => { clearInterval(restIntervalRef.current); setRestState(INIT_REST) }}
        onPreset={startRestTimer}
        onTogglePause={() => setRestState(prev => prev.remaining > 0 ? { ...prev, paused: !prev.paused } : prev)}
      />
    </>
  )
}
