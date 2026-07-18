import DayRingWidget from './DayRingWidget.jsx'
import ScheduleWidget from './ScheduleWidget.jsx'
import QueueWidget from './QueueWidget.jsx'
import PulseWidget from './PulseWidget.jsx'
import OverseerWidget from './OverseerWidget.jsx'
import GymNextWidget from './GymNextWidget.jsx'
import SleepWidget from './SleepWidget.jsx'
import ReadinessWidget from './ReadinessWidget.jsx'
import HabitsWeekWidget from './HabitsWeekWidget.jsx'
import JournalWidget from './JournalWidget.jsx'
import StreakWidget from './StreakWidget.jsx'

// Dashboard widget registry. Entry contract:
// { title, icon, component({size,bp}), sizes[], defaultSize, chromeless?,
//   autoPriority, autoSize:{2,3,4} }

const ICON_PROPS = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}

const ICONS = {
  dayring: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  ),
  schedule: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  queue: (
    <svg {...ICON_PROPS}>
      <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
    </svg>
  ),
  pulse: (
    <svg {...ICON_PROPS}>
      <path d="M2 12h4l3-8 4 16 3-8h6" />
    </svg>
  ),
  overseer: (
    <svg {...ICON_PROPS}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12z" />
    </svg>
  ),
  gymnext: (
    <svg {...ICON_PROPS}>
      <path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12" />
    </svg>
  ),
  sleep: (
    <svg {...ICON_PROPS}>
      <path d="M21 12.8A8 8 0 1 1 11.2 3a6.2 6.2 0 0 0 9.8 9.8z" />
    </svg>
  ),
  readiness: (
    <svg {...ICON_PROPS}>
      <path d="M4 17a8 8 0 1 1 16 0" opacity="0.4" />
      <path d="M12 17l3.5-5" />
    </svg>
  ),
  habits: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <path d="M8.5 12.5l2.4 2.4L15.5 9.5" />
    </svg>
  ),
  journal: (
    <svg {...ICON_PROPS}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  streak: (
    <svg {...ICON_PROPS}>
      <path d="M12 3c1.2 3 4 4 4 8a4 4 0 1 1-8 0c0-1.8 1-3 2-4 0 1.2.6 2 1.6 2C12.4 8 11 5 12 3z" />
    </svg>
  ),
}

export const DASH_WIDGETS = {
  dayring: {
    title: 'Day Ring',
    icon: ICONS.dayring,
    component: DayRingWidget,
    sizes: ['M', 'L', 'XL'],
    defaultSize: 'L',
    chromeless: true,
    autoPriority: 1,
    autoSize: { 2: 'L', 3: 'L', 4: 'L' },
  },
  schedule: {
    title: 'Schedule',
    icon: ICONS.schedule,
    component: ScheduleWidget,
    sizes: ['S', 'M', 'L'],
    defaultSize: 'M',
    autoPriority: 2,
    autoSize: { 2: 'M', 3: 'M', 4: 'M' },
  },
  queue: {
    title: 'Queue',
    icon: ICONS.queue,
    component: QueueWidget,
    sizes: ['S', 'M', 'L'],
    defaultSize: 'M',
    autoPriority: 3,
    autoSize: { 2: 'M', 3: 'S', 4: 'S' },
  },
  pulse: {
    title: "Today's Pulse",
    icon: ICONS.pulse,
    component: PulseWidget,
    sizes: ['M', 'L'],
    defaultSize: 'M',
    autoPriority: 4,
    autoSize: { 2: 'M', 3: 'M', 4: 'M' },
  },
  overseer: {
    title: 'Overseer',
    icon: ICONS.overseer,
    component: OverseerWidget,
    sizes: ['L', 'XL'],
    defaultSize: 'L',
    autoPriority: 5,
    autoSize: { 2: 'L', 3: 'L', 4: 'L' },
  },
  gymnext: {
    title: 'Next Workout',
    icon: ICONS.gymnext,
    component: GymNextWidget,
    sizes: ['S', 'M', 'L'],
    defaultSize: 'S',
    autoPriority: 6,
    autoSize: { 2: 'S', 3: 'S', 4: 'S' },
  },
  sleep: {
    title: 'Sleep',
    icon: ICONS.sleep,
    component: SleepWidget,
    sizes: ['S', 'M', 'L'],
    defaultSize: 'S',
    autoPriority: 7,
    autoSize: { 2: 'S', 3: 'S', 4: 'M' },
  },
  habits: {
    title: 'Habits',
    icon: ICONS.habits,
    component: HabitsWeekWidget,
    sizes: ['S', 'M', 'L'],
    defaultSize: 'M',
    autoPriority: 8,
    autoSize: { 2: 'M', 3: 'M', 4: 'M' },
  },
  journal: {
    title: 'Journal',
    icon: ICONS.journal,
    component: JournalWidget,
    sizes: ['S', 'M'],
    defaultSize: 'S',
    autoPriority: 9,
    autoSize: { 2: 'S', 3: 'S', 4: 'S' },
  },
  streak: {
    title: 'Streak',
    icon: ICONS.streak,
    component: StreakWidget,
    sizes: ['S', 'M'],
    defaultSize: 'S',
    autoPriority: 10,
    autoSize: { 2: 'S', 3: 'S', 4: 'S' },
  },
}

// Seed order mirrors today's dashboard, then the five new widgets appended.
export const DEFAULT_DASH_ORDER = ['dayring', 'schedule', 'queue', 'pulse', 'overseer', 'gymnext', 'sleep', 'habits', 'journal', 'streak']
