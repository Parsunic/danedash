// Hidden-widget chips. Registry METADATA only (icon + title) — the widget
// components themselves are never mounted while hidden.
export default function WidgetTray({ registry, hiddenIds, onAdd }) {
  if (!hiddenIds || hiddenIds.length === 0) return null
  return (
    <div className="dc-tray">
      {hiddenIds.map(id => {
        const entry = registry[id]
        if (!entry) return null
        return (
          <button key={id} className="dc-tray-chip" onClick={() => onAdd(id)}>
            {entry.icon ? <span className="dc-tray-chip-icon">{entry.icon}</span> : null}
            <span className="dc-tray-chip-title">{entry.title}</span>
            <span className="dc-tray-chip-plus">+</span>
          </button>
        )
      })}
    </div>
  )
}
