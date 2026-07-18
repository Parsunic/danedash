import DayRingWidget from './DayRingWidget.jsx'
import ScheduleWidget from './ScheduleWidget.jsx'
import QueueWidget from './QueueWidget.jsx'
import PulseWidget from './PulseWidget.jsx'
import OverseerWidget from './OverseerWidget.jsx'

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
}

// Seed order mirrors today's dashboard: ring, side-column widgets, overseer.
export const DEFAULT_DASH_ORDER = ['dayring', 'schedule', 'queue', 'pulse', 'overseer']
