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

const VIEWS = ['templates', 'planner', 'ai-coach', 'log', 'history', 'stats']
const VIEW_LABELS = { templates: 'Templates', planner: 'Planner', 'ai-coach': 'AI Coach', log: 'Log', history: 'History', stats: 'Stats' }
const DESKTOP_PANEL_VIEWS = ['templates', 'ai-coach', 'history', 'stats']

const INIT_REST = { visible: false, remaining: 0, total: 0, paused: false, lastSecs: 90 }

const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
const isGymMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches

export default function Gym() {
  const [activeView, setActiveView] = useState(isGymMobile ? 'log' : 'planner')
  const [activePanel, setActivePanel] = useState(null) // desktop panel: null = closed
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
    if (isDesktop) setActivePanel('log')
    else setActiveView('log')
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
      if (isDesktop) setActivePanel('history')
      else setActiveView('history')
    }, 1200)
  }, [activeSession])

  const handleAIPlanLoaded = useCallback(weekOffset => {
    setPlannerWeekOffset(weekOffset)
    if (isDesktop) setActivePanel('ai-coach')
    else setActiveView('planner')
  }, [])

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

  const restTimer = (
    <RestTimer
      restState={restState}
      onDismiss={() => { clearInterval(restIntervalRef.current); setRestState(INIT_REST) }}
      onPreset={startRestTimer}
      onTogglePause={() => setRestState(prev => prev.remaining > 0 ? { ...prev, paused: !prev.paused } : prev)}
    />
  )

  // ── DESKTOP LAYOUT ──
  if (isDesktop) {
    // Panel is visible when a session is active or user selected a panel view
    const panelVisible = activePanel !== null || activeSession !== null
    const panelContent = activeSession
      ? logContent
      : activePanel === 'templates' ? <TemplatesView />
      : activePanel === 'ai-coach' ? <AICoachView onPlanLoaded={handleAIPlanLoaded} />
      : activePanel === 'history' ? <HistoryView />
      : activePanel === 'stats' ? <StatsView />
      : null

    return (
      <>
        <div className="gym-desktop-header">
          <h1 className="dash-title" style={{ margin: 0 }}>Gym</h1>
          <div className="gym-panel-nav">
            {DESKTOP_PANEL_VIEWS.map(v => (
              <button
                key={v}
                className={`gym-panel-nav-btn${activePanel === v && !activeSession ? ' active' : ''}`}
                onClick={() => { if (!activeSession) setActivePanel(prev => prev === v ? null : v) }}
              >{VIEW_LABELS[v]}</button>
            ))}
          </div>
        </div>
        <div className={`gym-desktop-two-col${panelVisible ? '' : ' gym-planner-full'}`}>
          <div className="gym-desktop-planner-col">
            <PlannerView
              weekOffset={plannerWeekOffset}
              onWeekOffsetChange={setPlannerWeekOffset}
              onStartWorkout={startWorkout}
              desktopMode
            />
          </div>
          {panelVisible && (
            <div className="gym-desktop-col--panel">
              <div className="gym-panel-scroll">
                {panelContent}
              </div>
            </div>
          )}
        </div>
        {restTimer}
      </>
    )
  }

  // ── MOBILE LAYOUT ──
  return (
    <>
      <BackgroundBlob page="gym" />
      <h1 className="dash-title">Gym</h1>
      <div className="gym-subnav" style={{ overflowX: 'auto' }}>
        {VIEWS.map(v => (
          <button
            key={v}
            className={`gym-subnav-btn${activeView === v ? ' active' : ''}`}
            onClick={() => setActiveView(v)}
          >{VIEW_LABELS[v]}</button>
        ))}
      </div>

      <div className={`gym-view${activeView === 'templates' ? ' active' : ''}`}>
        <TemplatesView />
      </div>
      <div className={`gym-view${activeView === 'planner' ? ' active' : ''}`}>
        <PlannerView
          weekOffset={plannerWeekOffset}
          onWeekOffsetChange={setPlannerWeekOffset}
          onStartWorkout={startWorkout}
        />
      </div>
      <div className={`gym-view${activeView === 'ai-coach' ? ' active' : ''}`}>
        <AICoachView onPlanLoaded={handleAIPlanLoaded} />
      </div>
      <div className={`gym-view${activeView === 'log' ? ' active' : ''}`}>
        {logContent}
      </div>
      <div className={`gym-view${activeView === 'history' ? ' active' : ''}`}>
        <HistoryView />
      </div>
      <div className={`gym-view${activeView === 'stats' ? ' active' : ''}`}>
        <StatsView />
      </div>

      {restTimer}
    </>
  )
}
