// Front and back anatomical body SVG with per-muscle amber highlighting.
// activeFront / activeBack = Set of sub-muscle strings that are highlighted.
// intensity = 'primary' (full amber) or 'secondary' (dim amber).
// Each sub-muscle can appear in activePrimary or activeSecondary sets.

const AMBER      = '#E8A020'
const AMBER_DIM  = 'rgba(232,160,32,0.45)'
const BODY_BASE  = 'rgba(255,255,255,0.13)'
const BODY_DARK  = 'rgba(255,255,255,0.07)'

function muscleFill(id, primary, secondary) {
  if (primary.has(id)) return AMBER
  if (secondary.has(id)) return AMBER_DIM
  return null
}

// ── FRONT VIEW ────────────────────────────────────────────────────────────

function FrontBody({ primary, secondary }) {
  const f = (id, base = BODY_BASE) => muscleFill(id, primary, secondary) ?? base

  return (
    <svg viewBox="0 0 100 240" width="100%" style={{ display: 'block' }}>
      {/* ── silhouette base ─── */}
      {/* Head */}
      <circle cx="50" cy="13" r="10" fill={BODY_BASE} />
      {/* Neck */}
      <rect x="46" y="22" width="8" height="8" rx="1" fill={BODY_BASE} />
      {/* Torso */}
      <path d="M32,30 L68,30 L72,45 L72,115 L65,125 L35,125 L28,115 L28,45 Z" fill={BODY_DARK} />
      {/* Upper legs connector */}
      <path d="M35,125 L65,125 L67,145 L33,145 Z" fill={BODY_DARK} />
      {/* Left leg */}
      <path d="M33,145 L50,145 L50,230 L30,230 L30,150 Z" fill={BODY_DARK} />
      {/* Right leg */}
      <path d="M50,145 L67,145 L70,150 L70,230 L50,230 Z" fill={BODY_DARK} />
      {/* Left arm */}
      <path d="M28,30 L22,32 L18,48 L18,110 L26,112 L28,50 Z" fill={BODY_DARK} />
      {/* Right arm */}
      <path d="M72,30 L78,32 L82,48 L82,110 L74,112 L72,50 Z" fill={BODY_DARK} />
      {/* Hands */}
      <ellipse cx="22" cy="118" rx="5" ry="7" fill={BODY_DARK} />
      <ellipse cx="78" cy="118" rx="5" ry="7" fill={BODY_DARK} />
      {/* Feet */}
      <ellipse cx="40" cy="233" rx="10" ry="5" fill={BODY_DARK} />
      <ellipse cx="60" cy="233" rx="10" ry="5" fill={BODY_DARK} />

      {/* ── MUSCLE GROUPS ─── */}

      {/* Chest */}
      <path d="M34,31 L50,31 L50,65 L35,62 L31,50 L33,38 Z" fill={f('chest')} opacity="0.9" />
      <path d="M50,31 L66,31 L67,38 L69,50 L65,62 L50,65 Z" fill={f('chest')} opacity="0.9" />

      {/* Front Delt */}
      <path d="M28,30 L33,30 L33,45 L28,50 L24,44 L26,34 Z" fill={f('front_delt')} />
      <path d="M67,30 L72,30 L74,34 L76,44 L72,50 L67,45 Z" fill={f('front_delt')} />

      {/* Mid Delt */}
      <path d="M22,32 L28,30 L28,50 L24,54 L19,48 L19,38 Z" fill={f('mid_delt')} />
      <path d="M72,30 L78,32 L81,38 L81,48 L76,54 L72,50 Z" fill={f('mid_delt')} />

      {/* Biceps */}
      <path d="M19,50 L25,50 L27,80 L19,80 Z" fill={f('biceps')} rx="3" />
      <path d="M73,50 L81,50 L81,80 L73,80 Z" fill={f('biceps')} rx="3" />

      {/* Forearms */}
      <path d="M19,82 L26,82 L26,112 L20,112 Z" fill={f('forearms')} />
      <path d="M74,82 L80,82 L80,112 L74,112 Z" fill={f('forearms')} />

      {/* Upper Abs */}
      <rect x="38" y="65" width="24" height="24" rx="3" fill={f('upper_abs')} opacity="0.9" />

      {/* Lower Abs */}
      <rect x="38" y="90" width="24" height="22" rx="3" fill={f('lower_abs')} opacity="0.9" />

      {/* Obliques */}
      <path d="M31,65 L38,65 L38,112 L31,118 L28,108 L28,72 Z" fill={f('obliques')} />
      <path d="M62,65 L69,65 L72,72 L72,108 L69,118 L62,112 Z" fill={f('obliques')} />

      {/* Quads */}
      <path d="M34,147 L50,147 L50,210 L32,208 L32,155 Z" fill={f('quads')} opacity="0.9" />
      <path d="M50,147 L66,147 L68,155 L68,208 L50,210 Z" fill={f('quads')} opacity="0.9" />

      {/* Adductors (inner thigh) */}
      <path d="M45,147 L55,147 L54,200 L46,200 Z" fill={f('adductors')} opacity="0.8" />

      {/* Calves (front shin, subtle) */}
      <path d="M32,210 L48,212 L47,228 L31,226 Z" fill={f('calves')} opacity="0.7" />
      <path d="M52,212 L68,210 L69,226 L53,228 Z" fill={f('calves')} opacity="0.7" />
    </svg>
  )
}

// ── BACK VIEW ────────────────────────────────────────────────────────────

function BackBody({ primary, secondary }) {
  const f = (id, base = BODY_BASE) => muscleFill(id, primary, secondary) ?? base

  return (
    <svg viewBox="0 0 100 240" width="100%" style={{ display: 'block' }}>
      {/* ── silhouette base ─── */}
      <circle cx="50" cy="13" r="10" fill={BODY_BASE} />
      <rect x="46" y="22" width="8" height="8" rx="1" fill={BODY_BASE} />
      <path d="M32,30 L68,30 L72,45 L72,115 L65,125 L35,125 L28,115 L28,45 Z" fill={BODY_DARK} />
      <path d="M35,125 L65,125 L67,145 L33,145 Z" fill={BODY_DARK} />
      <path d="M33,145 L50,145 L50,230 L30,230 L30,150 Z" fill={BODY_DARK} />
      <path d="M50,145 L67,145 L70,150 L70,230 L50,230 Z" fill={BODY_DARK} />
      <path d="M28,30 L22,32 L18,48 L18,110 L26,112 L28,50 Z" fill={BODY_DARK} />
      <path d="M72,30 L78,32 L82,48 L82,110 L74,112 L72,50 Z" fill={BODY_DARK} />
      <ellipse cx="22" cy="118" rx="5" ry="7" fill={BODY_DARK} />
      <ellipse cx="78" cy="118" rx="5" ry="7" fill={BODY_DARK} />
      <ellipse cx="40" cy="233" rx="10" ry="5" fill={BODY_DARK} />
      <ellipse cx="60" cy="233" rx="10" ry="5" fill={BODY_DARK} />

      {/* ── MUSCLE GROUPS ─── */}

      {/* Traps */}
      <path d="M34,30 L50,22 L66,30 L68,42 L50,46 L32,42 Z" fill={f('traps')} opacity="0.9" />

      {/* Rear Delt */}
      <path d="M28,30 L34,30 L34,46 L28,50 L24,44 L25,34 Z" fill={f('rear_delt')} />
      <path d="M66,30 L72,30 L75,34 L76,44 L72,50 L66,46 Z" fill={f('rear_delt')} />

      {/* Lats */}
      <path d="M28,48 L36,46 L38,95 L29,105 L26,90 Z" fill={f('lats')} opacity="0.9" />
      <path d="M72,48 L64,46 L62,95 L71,105 L74,90 Z" fill={f('lats')} opacity="0.9" />

      {/* Mid Back (rhomboids + mid traps) */}
      <path d="M36,46 L64,46 L62,80 L38,80 Z" fill={f('mid_back')} opacity="0.9" />

      {/* Lower Back */}
      <path d="M36,80 L64,80 L65,115 L35,115 Z" fill={f('lower_back')} opacity="0.9" />

      {/* Triceps */}
      <path d="M19,50 L25,50 L27,82 L19,82 Z" fill={f('triceps')} />
      <path d="M73,50 L81,50 L81,82 L75,82 Z" fill={f('triceps')} />

      {/* Forearms back */}
      <path d="M19,84 L25,84 L25,112 L20,112 Z" fill={f('forearms')} opacity="0.7" />
      <path d="M75,84 L80,84 L80,112 L75,112 Z" fill={f('forearms')} opacity="0.7" />

      {/* Glutes */}
      <path d="M33,127 L50,127 L50,155 L31,155 L31,140 Z" fill={f('glutes')} opacity="0.9" />
      <path d="M50,127 L67,127 L69,140 L69,155 L50,155 Z" fill={f('glutes')} opacity="0.9" />

      {/* Hamstrings */}
      <path d="M31,157 L50,157 L50,210 L30,208 Z" fill={f('hamstrings')} opacity="0.9" />
      <path d="M50,157 L69,157 L70,208 L50,210 Z" fill={f('hamstrings')} opacity="0.9" />

      {/* Calves */}
      <path d="M31,210 L48,212 L46,228 L30,226 Z" fill={f('calves')} opacity="0.9" />
      <path d="M52,212 L69,210 L70,226 L54,228 Z" fill={f('calves')} opacity="0.9" />
    </svg>
  )
}

// ── EXPORTED COMPONENT ────────────────────────────────────────────────────

export default function BodySVG({ activePrimary = [], activeSecondary = [] }) {
  const primary   = new Set(activePrimary)
  const secondary = new Set(activeSecondary)

  return (
    <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 340, margin: '0 auto' }}>
      <div style={{ flex: 1 }}>
        <FrontBody primary={primary} secondary={secondary} />
      </div>
      <div style={{ flex: 1 }}>
        <BackBody primary={primary} secondary={secondary} />
      </div>
    </div>
  )
}
