import React from 'react'

// Per-card shell: outer .dc-item carries grid spans (data-size) and is reserved
// for FLIP transforms; inner .dc-jiggle is the edit-mode wiggle target.
// Edit chrome renders as SIBLINGS of the content — the `editing && …`
// expressions keep their child slots (as `false`) in both modes, so the widget
// child never shifts tree position and never remounts on enter/exit edit.
function CardShell({ id, size, editing, chromeless, sizes, onHide, onCycleSize, children }) {
  const content = chromeless
    ? <div className="dc-content">{children}</div>
    : <div className="dc-card"><div className="dc-content">{children}</div></div>
  return (
    <div className="dc-item" data-id={id} data-size={size}>
      <div className="dc-jiggle">
        {editing && !!onHide && (
          <button
            className="dc-hide-btn"
            onClick={() => onHide(id)}
            aria-label="Hide widget"
          >−</button>
        )}
        {editing && !!onCycleSize && Array.isArray(sizes) && sizes.length > 1 && (
          <button
            className="dc-size-btn"
            onClick={() => onCycleSize(id)}
            aria-label="Change size"
          >{size}</button>
        )}
        {content}
      </div>
    </div>
  )
}

export default React.memo(CardShell)
