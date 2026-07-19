import { useState, useCallback, useRef, useEffect } from 'react'
import { storeGet, storeSet, storeDelete } from '../../lib/storage.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { FlipTitle } from '../../components/FlipSwitch.jsx'
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
import ExercisesView from './components/ExercisesView.jsx'

const OVERLAY_TABS = ['stats', 'exercises', 'templates', 'ai-coach', 'history']
const OVERLAY_LABELS = { templates: 'Templates', 'ai-coach': 'AI Coach', history: 'History', stats: 'Stats', log: 'Log', exercises: 'Exercises' }

const INIT_REST = { visible: false, remaining: 0, total: 0, paused: false, lastSecs: 90 }
const ACTIVE_SESSION_KEY = 'gym_active_session'

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

function DumbbellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" />
    </svg>
  )
}

function StatsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}

export default function Gym() {
  const _savedSession = storeGet(ACTIVE_SESSION_KEY)
  const _hasSession = !!(_savedSession && !_savedSession.__done)
  const [flipped, setFlipped] = useState(_hasSession)
  const [overlayTab, setOverlayTab] = useState(_hasSession ? 'log' : 'stats')
  const [plannerViewMode, setPlannerViewMode] = useState('month')
  const [plannerWeekOffset, setPlannerWeekOffset] = useState(0)
  const [activeSession, setActiveSession] = useState(_savedSession || null)
  const [restState, setRestState] = useState(INIT_REST)
  const [expandOverlay, setExpandOverlay] = useState(null)
  const [titleSpin, setTitleSpin] = useState(false)
  const restIntervalRef = useRef(null)
  const flipperRef = useRef(null)
  const gymContainerRef = useRef(null)
  const titleSpinTimer = useRef(null)

  const spinTitle = useCallback(() => {
    setTitleSpin(true)
    clearTimeout(titleSpinTimer.current)
    titleSpinTimer.current = setTimeout(() => setTitleSpin(false), 680)
  }, [])

  useEffect(() => {
    window.__swipeDisabled = flipped && overlayTab === 'log'
    return () => { window.__swipeDisabled = false }
  }, [flipped, overlayTab])

  // ── FLIP ──
  const flipToBack = useCallback((tab = 'templates') => {
    setOverlayTab(tab)
    if (flipperRef.current) flipperRef.current.style.transition = 'transform 680ms cubic-bezier(0.34, 1.3, 0.64, 1)'
    spinTitle()
    setFlipped(true)
  }, [spinTitle])

  const flipToFront = useCallback(() => {
    if (flipperRef.current) flipperRef.current.style.transition = 'transform 520ms cubic-bezier(0.4, 0, 0.2, 1)'
    spinTitle()
    setFlipped(false)
  }, [spinTitle])

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
          notifyRestDone() // backgrounded push; in-app overlay covers foreground
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

  useEffect(() => () => { clearInterval(restIntervalRef.current); clearTimeout(titleSpinTimer.current) }, [])
  useEffect(() => { runMuscleMigration().catch(() => {}) }, [])

  // Auto-finish logic: if enabled, finish workout after 3h total with 30m idle
  useEffect(() => {
    if (!activeSession || activeSession.__done) return
    const check = () => {
      const settings = storeGet('gym_settings') || {}
      if (!settings.autoFinish) return
      const now = Date.now()
      const elapsed = now - activeSession.startedAt
      if (elapsed < 3 * 3600 * 1000) return
      // Find last set log time across all exercises
      let lastSetTime = activeSession.startedAt
      activeSession.exercises.forEach(ex => {
        ex.sets?.forEach(s => {
          if (s.loggedAt && s.loggedAt > lastSetTime) lastSetTime = s.loggedAt
        })
      })
      const idleMs = now - lastSetTime
      if (idleMs >= 30 * 60 * 1000) {
        // Auto-finish — set completedAt to last set time
        handleFinishWorkoutAt(lastSetTime)
      }
    }
    const interval = setInterval(check, 60 * 1000)
    return () => clearInterval(interval)
  }, [activeSession])

  // Persist active session so it survives app close/reopen
  useEffect(() => {
    if (activeSession && !activeSession.__done) {
      storeSet(ACTIVE_SESSION_KEY, activeSession)
    } else {
      storeDelete(ACTIVE_SESSION_KEY)
    }
  }, [activeSession])

  // ── EXPAND OVERLAY CLOSE ──
  const closeExpandOverlay = useCallback(() => {
    const hasLoggedSets = activeSession && !activeSession.__done &&
      activeSession.exercises?.some(ex => ex.sets.length > 0)
    setExpandOverlay(prev => prev ? { ...prev, phase: 'collapsing' } : prev)
    setTimeout(() => {
      setExpandOverlay(null)
      if (hasLoggedSets) {
        setOverlayTab('log')
        setFlipped(true)
      } else {
        setActiveSession(null)
      }
    }, 380)
  }, [activeSession])

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

  const handleLogAllSets = useCallback((ei, rows) => {
    const validRows = rows.filter(r => parseFloat(r.weight) > 0 && parseInt(r.reps) > 0 && r.rpe)
    if (!validRows.length) return
    setActiveSession(prev => {
      if (!prev) return prev
      const hist = storeGet('gym_exercise_history') || {}
      const ex = prev.exercises[ei]
      const histPR = hist[ex.name]?.allTimePR || 0
      const sessionMax = ex.sets.reduce((m, s) => Math.max(m, s.weight || 0), 0)
      let currentPR = Math.max(histPR, sessionMax)
      const newSets = validRows.map(r => {
        const weight = parseFloat(r.weight)
        const reps = parseInt(r.reps)
        const e1rm = calcE1RM(weight, reps)
        const isPR = weight > currentPR
        if (isPR) currentPR = weight
        return { weight, reps, rpe: r.rpe, isPR, e1rm }
      })
      return {
        ...prev,
        exercises: prev.exercises.map((e, i) =>
          i === ei ? { ...e, sets: [...e.sets, ...newSets] } : e
        ),
      }
    })
    startRestTimer(restState.lastSecs)
  }, [startRestTimer, restState.lastSecs])

  const handleEditSets = useCallback((ei, rows) => {
    setActiveSession(prev => {
      if (!prev) return prev
      const hist = storeGet('gym_exercise_history') || {}
      const exName = prev.exercises[ei]?.name
      const histPR = exName ? (hist[exName]?.allTimePR || 0) : 0
      let currentPR = histPR
      const recalculated = rows
        .filter(r => parseFloat(r.weight) > 0 && parseInt(r.reps) > 0)
        .map(r => {
          const weight = parseFloat(r.weight)
          const reps = parseInt(r.reps)
          const e1rm = calcE1RM(weight, reps)
          const isPR = weight > currentPR
          if (isPR) currentPR = weight
          return { weight, reps, rpe: r.rpe || null, isPR, e1rm }
        })
      return {
        ...prev,
        exercises: prev.exercises.map((e, i) => i === ei ? { ...e, sets: recalculated } : e),
      }
    })
  }, [])

  const handleSkipExercise = useCallback((ei) => {
    setActiveSession(prev => {
      if (!prev) return prev
      return { ...prev, exercises: prev.exercises.filter((_, i) => i !== ei) }
    })
  }, [])

  const handleSubstituteExercise = useCallback((ei, newEx) => {
    setActiveSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        exercises: prev.exercises.map((e, i) =>
          i === ei ? { ...e, name: newEx.name, sets: [] } : e
        ),
      }
    })
  }, [])

  const handleAddExerciseToSession = useCallback((exercise) => {
    setActiveSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        exercises: [...prev.exercises, {
          name: exercise.name,
          repRange: '8-10',
          notes: '',
          targetSets: 3,
          sets: [],
          primary_muscle: exercise.primary_muscle || null,
        }],
      }
    })
  }, [])

  const handleFinishWorkoutAt = useCallback(async (finishTime) => {
    if (!activeSession) return
    const sessionToFinish = activeSession
    const hist = storeGet('gym_exercise_history') || {}
    sessionToFinish.exercises.forEach(ex => {
      if (!ex.sets.length) return
      const { hi } = parseRepRange(ex.repRange)
      const best = ex.sets.reduce((a, b) => (b.e1rm || 0) > (a.e1rm || 0) ? b : a)
      const avgRpe = parseFloat((ex.sets.reduce((s, x) => s + x.rpe, 0) / ex.sets.length).toFixed(1))
      const allHitTop = ex.sets.every(s => s.reps >= hi)
      if (!hist[ex.name]) hist[ex.name] = { sessions: [], allTimePR: 0 }
      const exH = hist[ex.name]
      ex.sets.forEach(s => { if (s.weight > (exH.allTimePR || 0)) exH.allTimePR = s.weight })
      exH.sessions = exH.sessions || []
      exH.sessions.push({ date: sessionToFinish.date, weight: best.weight, reps: best.reps, rpe: avgRpe, e1rm: best.e1rm, allHitTop })
      if (exH.sessions.length > 20) exH.sessions = exH.sessions.slice(-20)
    })
    storeSet('gym_exercise_history', hist)

    const exNames = sessionToFinish.exercises.map(ex => ex.name).filter(Boolean)
    const muscleMap = await lookupMusclesBatch(exNames).catch(() => ({}))
    const logs = storeGet('gym_workout_logs') || []
    logs.push({
      id: sessionToFinish.id, date: sessionToFinish.date, name: sessionToFinish.name,
      plannedId: sessionToFinish.plannedId, startedAt: sessionToFinish.startedAt,
      completedAt: new Date(finishTime).toISOString(),
      duration: finishTime - sessionToFinish.startedAt,
      exercises: sessionToFinish.exercises.map(ex => {
        const muscle = muscleMap[ex.name] ?? 'other'
        return {
          name: ex.name, primary_muscle: muscle,
          e1rm: ex.sets.length ? Math.max(...ex.sets.map(s => s.e1rm || 0)) : null,
          sets: ex.sets.map(s => ({ ...s, primary_muscle: muscle })),
        }
      }),
    })
    if (logs.length > 200) logs.splice(0, logs.length - 200)
    storeSet('gym_workout_logs', logs)

    if (sessionToFinish.plannedId) {
      const planned = storeGet('gym_planned') || []
      const pi = planned.findIndex(p => p.id === sessionToFinish.plannedId)
      if (pi >= 0) { planned[pi].status = 'completed'; storeSet('gym_planned', planned) }
    }

    storeDelete(ACTIVE_SESSION_KEY)
    setActiveSession(null)
    setActiveSession({ __done: true, name: sessionToFinish.name })
    setTimeout(() => {
      setActiveSession(null)
      setOverlayTab('history')
    }, 1200)
  }, [activeSession])

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
    storeDelete(ACTIVE_SESSION_KEY)
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

  const handleCancelWorkout = useCallback(() => {
    storeDelete(ACTIVE_SESSION_KEY)
    setActiveSession(null)
    if (expandOverlay) {
      setExpandOverlay(prev => prev ? { ...prev, phase: 'collapsing' } : prev)
      setTimeout(() => setExpandOverlay(null), 380)
    }
  }, [expandOverlay])

  const handleResumeWorkout = useCallback((log) => {
    const exercises = (log.exercises || []).map(ex => ({
      name: ex.name,
      repRange: '8-10',
      notes: '',
      targetSets: ex.sets?.length || 3,
      sets: [],
    }))
    startWorkout(exercises, null, log.name + ' (resumed)', false)
    setOverlayTab('log')
    if (!flipped) flipToBack('log')
  }, [startWorkout, flipped, flipToBack])

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
      onLogAllSets={handleLogAllSets}
      onEditSets={handleEditSets}
      onSkip={handleSkipExercise}
      onSubstitute={handleSubstituteExercise}
      onFinish={handleFinishWorkout}
      onCancel={handleCancelWorkout}
      onStartWorkout={startWorkout}
      onAddExercise={handleAddExerciseToSession}
    />
  )

  return (
    <>
      <BackgroundBlob page="gym" />

      <div className="gym-page-content stagger-1" ref={gymContainerRef}>
        <div className="gym-flip-container">
          <div ref={flipperRef} className={`gym-flipper${flipped ? ' is-flipped' : ''}`}>

            {/* FRONT FACE — Planner */}
            <div className="gym-face gym-face-front" style={flipped ? { pointerEvents: 'none' } : {}}>
              <div className="gym-face-top" style={isDesktop && plannerViewMode === 'month' ? { paddingRight: 90 } : {}}>
                <FlipTitle
                  icon={<DumbbellIcon />}
                  label="Gym"
                  isFlipping={titleSpin}
                  onClick={() => flipToBack('stats')}
                  title="Switch to Stats"
                />
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
                <FlipTitle
                  icon={<StatsIcon />}
                  label="Stats"
                  isFlipping={titleSpin}
                  onClick={flipToFront}
                  title="Back to Gym"
                  className="gym-back-flip"
                />
                <div className="gym-overlay-tabs">
                  {visibleTabs.map(tab => (
                    <button
                      key={tab}
                      className={overlayTab === tab ? 'btn-primary' : 'btn-secondary'}
                      style={{ fontSize: '0.8125rem', padding: '7px 14px' }}
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
                {overlayTab === 'history' && <HistoryView onResume={handleResumeWorkout} />}
                {overlayTab === 'stats' && <StatsView />}
                {overlayTab === 'exercises' && <ExercisesView />}
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
                <div className="gym-expand-log-scroll">
                  {logContent}
                </div>
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
