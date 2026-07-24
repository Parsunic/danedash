import { SKINS } from './overseerConfig.js'

// Boot-companion pixel sprites — pure CSS box-shadow maps (ovt- block in
// globals.css), 8px base unit, app palette (amber body / mint accents).
// Layering: .ovt-sprite (size box, per-skin --ovt-w/--ovt-h × --ovt-ss scale)
//   > .ovt-anim (idle / thinking / verdict state animations — transforms live here)
//     > .ovt-px (8×8, scaled; ::before carries the shadow map)  — or .ovt-stax (3 bars).
// States: idle (skin's own anim) · thinking (fast bob while streaming) ·
// verdict (one-shot mint pulse). prefers-reduced-motion → all static.

export { SKINS }

export function OvtSprite({ skin = 'blip', state = 'idle', scale = 1 }) {
  const s = SKINS.includes(skin) ? skin : 'blip'
  return (
    <span
      className={`ovt-sprite ovt-sprite--${s} is-${state}`}
      style={{ '--ovt-ss': scale }}
      aria-hidden="true"
    >
      <span className="ovt-anim">
        {s === 'stax'
          ? <span className="ovt-stax"><i /><i /><i /></span>
          : <span className="ovt-px" />}
      </span>
    </span>
  )
}
