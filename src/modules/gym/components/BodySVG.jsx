// Front and back anatomical body map with per-muscle amber highlighting.
// Muscles are drawn as faceted polygons (low-poly anatomy style) that tile within a dark
// silhouette, separated by a thin dark stroke so groups read as distinct surfaces.
//   activePrimary   = sub-muscles worked as the prime mover  → solid amber
//   activeSecondary = sub-muscles worked as assistance       → dim amber

const AMBER     = '#E8A020'
const AMBER_DIM = 'rgba(232,160,32,0.42)'
const BODY_BASE = 'rgba(255,255,255,0.10)'
const SILHOUETTE = 'rgba(255,255,255,0.045)'
const SEP        = '#0a0a0c'

// Mirror a "x,y x,y ..." point string across the vertical centre line (x = 100).
function mirror(points) {
  return points.trim().split(/\s+/).map(p => {
    const [x, y] = p.split(',')
    return `${(100 - parseFloat(x)).toFixed(1)},${y}`
  }).join(' ')
}

function fillFor(id, primary, secondary) {
  if (primary.has(id)) return AMBER
  if (secondary.has(id)) return AMBER_DIM
  return BODY_BASE
}

// One muscle facet (auto-renders its mirror when `mirrored`).
function Muscle({ id, points, primary, secondary, mirrored = true, opacity = 1 }) {
  const fill = fillFor(id, primary, secondary)
  return (
    <>
      <polygon points={points} fill={fill} stroke={SEP} strokeWidth="0.6"
        opacity={opacity} style={{ transition: 'fill 450ms ease' }} />
      {mirrored && (
        <polygon points={mirror(points)} fill={fill} stroke={SEP} strokeWidth="0.6"
          opacity={opacity} style={{ transition: 'fill 450ms ease' }} />
      )}
    </>
  )
}

// ── SHARED SILHOUETTE ──────────────────────────────────────────────────────

function Silhouette() {
  return (
    <g fill={SILHOUETTE}>
      <circle cx="50" cy="14" r="9" />
      <polygon points="45,21 55,21 56,29 44,29" />
      {/* torso */}
      <polygon points="33,29 67,29 73,41 72,118 63,127 37,127 28,118 27,41" />
      {/* arms */}
      <polygon points="27,39 17,45 17,104 26,107 28,53" />
      <polygon points="73,39 83,45 83,104 74,107 72,53" />
      {/* hands */}
      <ellipse cx="20" cy="111" rx="5" ry="6.5" />
      <ellipse cx="80" cy="111" rx="5" ry="6.5" />
      {/* legs */}
      <polygon points="33,120 50,120 50,237 31,237 29,150" />
      <polygon points="50,120 67,120 71,150 69,237 50,237" />
      {/* feet */}
      <ellipse cx="38" cy="239" rx="9" ry="4.5" />
      <ellipse cx="62" cy="239" rx="9" ry="4.5" />
    </g>
  )
}

// ── FRONT VIEW ─────────────────────────────────────────────────────────────

function FrontBody({ primary, secondary }) {
  const m = (id, points, extra) => <Muscle id={id} points={points} primary={primary} secondary={secondary} {...extra} />
  return (
    <svg viewBox="0 0 100 250" width="100%" style={{ display: 'block' }}>
      <Silhouette />
      {/* Pectorals */}
      {m('chest', '50,33 37,35 33,49 43,55 50,55')}
      {/* Front deltoids */}
      {m('front_delt', '37,34 27,39 25,51 33,50 36,41')}
      {/* Biceps */}
      {m('biceps', '26,53 33,52 32,75 25,73')}
      {/* Forearms */}
      {m('forearms', '25,77 32,76 31,102 24,100')}
      {/* Obliques */}
      {m('obliques', '42,58 36,59 35,99 43,103')}
      {/* Upper abs (centre, not mirrored) */}
      {m('upper_abs', '43,57 57,57 56,79 44,79', { mirrored: false })}
      {/* Lower abs (centre) */}
      {m('lower_abs', '44,81 56,81 55,104 45,104', { mirrored: false })}
      {/* Quadriceps */}
      {m('quads', '36,129 48,129 47,193 34,190 34,140')}
      {/* Adductors (centre) */}
      {m('adductors', '45,131 55,131 54,180 46,180', { mirrored: false })}
      {/* Shins / front calves */}
      {m('calves', '36,201 47,202 46,232 38,230', { opacity: 0.92 })}
    </svg>
  )
}

// ── BACK VIEW ──────────────────────────────────────────────────────────────

function BackBody({ primary, secondary }) {
  const m = (id, points, extra) => <Muscle id={id} points={points} primary={primary} secondary={secondary} {...extra} />
  return (
    <svg viewBox="0 0 100 250" width="100%" style={{ display: 'block' }}>
      <Silhouette />
      {/* Trapezius (centre) */}
      {m('traps', '39,30 50,24 61,30 60,45 50,48 40,45', { mirrored: false })}
      {/* Rear deltoids */}
      {m('rear_delt', '38,33 28,38 26,50 34,49 37,41')}
      {/* Lats */}
      {m('lats', '38,49 44,51 43,90 30,92 31,62')}
      {/* Mid back (centre) */}
      {m('mid_back', '41,48 59,48 58,73 42,73', { mirrored: false })}
      {/* Lower back (centre) */}
      {m('lower_back', '42,75 58,75 57,105 43,105', { mirrored: false })}
      {/* Triceps */}
      {m('triceps', '26,53 33,52 32,76 25,74')}
      {/* Forearms */}
      {m('forearms', '25,78 32,77 31,102 24,100', { opacity: 0.85 })}
      {/* Glutes */}
      {m('glutes', '34,119 49,119 49,151 33,151 32,133')}
      {/* Hamstrings */}
      {m('hamstrings', '33,153 49,153 48,196 33,193')}
      {/* Calves */}
      {m('calves', '33,201 48,202 46,231 34,229')}
    </svg>
  )
}

// ── EXPORTED COMPONENT ──────────────────────────────────────────────────────

export default function BodySVG({ activePrimary = [], activeSecondary = [] }) {
  const primary   = new Set(activePrimary)
  const secondary = new Set(activeSecondary)

  return (
    <div className="body-svg-wrap">
      <div className="body-svg-half">
        <FrontBody primary={primary} secondary={secondary} />
        <div className="body-svg-label">Front</div>
      </div>
      <div className="body-svg-half">
        <BackBody primary={primary} secondary={secondary} />
        <div className="body-svg-label">Back</div>
      </div>
    </div>
  )
}
