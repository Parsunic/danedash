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

const OVERLAY_TABS = ['stats', 'templates', 'ai-coach', 'history']
const OVERLAY_LABELS = { templates: 'Templates', 'ai-coach': 'AI Coach', history: 'History', stats: 'Stats', log: 'Log' }

const INIT_REST = { visible: false, remaining: 0, total: 0, paused: false, lastSecs: 90 }

const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(13,13,13,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function getOverlayStyle(overlay) {
  if (!overlay) return {}
  if (overlay.phase === 'start') {
    return {
      top: overlay.relRect.top + 'px',
      left: overlay.relRect.left + 'px',
      width: overlay.relRect.width + 'px',
      height: overlay.relRect.height + 'px',
      background: hexToRgba(overlay.domColor, 0.4),
      borderRadius: '6px',
      opacity: 1,
    }
  }
  if (overlay.phase === 'collapsing') {
    return {
      top: '30%',
      left: '25%',
      width: '50%',
      height: '40%',
      background: 'rgba(13,13,13,0)',
      borderRadius: '12px',
      opacity: 0,
    }
  }
  return {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: '#0d0d0d',
    borderRadius: '12px',
    opacity: 1,
  }
}

export default function Gym() {
  const [flipped, setFlipped] = useState(false)
  const [overlayTab, setOverlayTab] = useState('stats')
  const [plannerViewMode, setPlannerViewMode] = useState('month')
  const [plannerWeekOffset, setPlannerWeekOffset] = useState(0)
  const [activeSession, setActiveSession] = useState(null)
  const [restState, setRestState] = useState(INIT_REST)
  const [expandOverlay, setExpandOverlay] = useState(null)
  const restIntervalRef = useRef(null)
  const flipperRef = useRef(null)
  const gymContainerRef = useRef(null)

  // ── FLIP ──
  const flipToBack = useCallback((tab = 'templates') => {
    setOverlayTab(tab)
    if (flipperRef.current) flipperRef.current.style.transition = 'transform 680ms cubic-bezier(0.34, 1.3, 0.64, 1)'
    setFlipped(true)
  }, [])

  const flipToFront = useCallback(() => {
    if (flipperRef.current) flipperRef.current.style.transition = 'transform 520ms cubic-bezier(0.4, 0, 0.2, 1)'
    setFlipped(false)
  }, [])

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

  // ── EXPAND OVERLAY CLOSE ──
  const closeExpandOverlay = useCallback(() => {
    setExpandOverlay(prev => prev ? { ...prev, phase: 'collapsing' } : prev)
    setTimeout(() => {
      setExpandOverlay(null)
      setActiveSession(null)
    }, 380)
  }, [])

  // ── WORKOUT CONTROL ──
  const startWorkout = useCallback((exList, plannedId, name, isTemplate = false, cellElement = null, domColor = null) => {
    const session = {
      id: gymUUID(), plannedId: plannedId || null,
      name: name || 'Workout', date: getActiveDateString(), startedAt: Date.now(),
      isTemplate: !!isTemplate,
      exercises: exList.filter(ex => ex.name).map(ex => ({
        name: ex.name, repRange: ex.repRange || '8-10',
        notes: ex.notes || '', targetSets: ex.sets || 3, sets: [],
      })),
    }

    if (cellElement && gymContainerRef.current) {
      const cellRect = cellElement.getBoundingClientRect()
      const containerRect = gymContainerRef.current.getBoundingClientRect()
      const relRect = {
        top: cellRect.top - containerRect.top,
        left: cellRect.left - containerRect.left,
        width: cellRect.width,
        height: cellRect.height,
      }
      setActiveSession(session)
      setExpandOverlay({ relRect, domColor, phase: 'start' })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setExpandOverlay(prev => prev ? { ...prev, phase: 'expanding' } : prev)
      }))
      setTimeout(() => {
        setExpandOverlay(prev => prev ? { ...prev, phase: 'shown' } : prev)
      }, 520)
    } else {
      setActiveSession(session)
      flipToBack('log')
    }
  }, [flipToBack])

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
    const hadExpandOverlay = !!expandOverlay
    setActiveSession(null)
    setActiveSession({ __done: true, name: sName })
    setTimeout(() => {
      setActiveSession(null)
      if (hadExpandOverlay) {
        setExpandOverlay(prev => prev ? { ...prev, phase: 'collapsing' } : prev)
        setTimeout(() => setExpandOverlay(null), 380)
      } else {
        setOverlayTab('history')
      }
    }, 1200)
  }, [activeSession, expandOverlay])

  const handleAIPlanLoaded = useCallback(weekOffset => {
    setPlannerWeekOffset(weekOffset)
    flipToFront()
  }, [flipToFront])

  const visibleTabs = (activeSession && !expandOverlay) ? ['log', ...OVERLAY_TABS] : OVERLAY_TABS

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

      <div className="gym-page-content" ref={gymContainerRef}>
        <div className="gym-flip-container">
          <div ref={flipperRef} className={`gym-flipper${flipped ? ' is-flipped' : ''}`}>

            {/* FRONT FACE — Planner */}
            <div className="gym-face gym-face-front" style={flipped ? { pointerEvents: 'none' } : {}}>
              <div className="gym-face-top" style={isDesktop && plannerViewMode === 'month' ? { paddingRight: 90 } : {}}>
                <h1 className="dash-title">Gym</h1>
                <button className="gym-flip-trigger" onClick={() => flipToBack('stats')}>
                  Stats ›
                </button>
              </div>
              <PlannerView
                weekOffset={plannerWeekOffset}
                onWeekOffsetChange={setPlannerWeekOffset}
                onStartWorkout={startWorkout}
                desktopMode={isDesktop}
                onViewModeChange={setPlannerViewMode}
              />
            </div>

            {/* BACK FACE — Templates / AI Coach / History / Stats / Log */}
            <div className="gym-face gym-face-back" style={!flipped ? { pointerEvents: 'none' } : {}}>
              <div className="gym-back-header">
                <button className="gym-back-btn" onClick={flipToFront}>‹ Planner</button>
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
              </div>
              <div className="gym-overlay-content">
                {overlayTab === 'templates' && <TemplatesView />}
                {overlayTab === 'ai-coach' && <AICoachView onPlanLoaded={handleAIPlanLoaded} />}
                {overlayTab === 'history' && <HistoryView />}
                {overlayTab === 'stats' && <StatsView />}
                {overlayTab === 'log' && logContent}
              </div>
            </div>

          </div>
        </div>

        {/* Cell expand overlay */}
        {expandOverlay && (
          <div
            className={`gym-expand-overlay${expandOverlay.phase === 'collapsing' ? ' gym-expand-overlay--collapsing' : ''}`}
            style={getOverlayStyle(expandOverlay)}
          >
            {(expandOverlay.phase === 'shown' || expandOverlay.phase === 'collapsing') && (
              <div className="gym-expand-content">
                <div className="gym-expand-back">
                  <button className="gym-back-btn" onClick={closeExpandOverlay}>‹ Back</button>
                </div>
                {logContent}
              </div>
            )}
          </div>
        )}
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
