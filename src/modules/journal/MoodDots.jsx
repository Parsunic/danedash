// Shared 1–5 mood selector — five tappable dots.
// Used by the Journal Write face (log a mood on an entry) and the Reflect-face
// Browse card (filter by mood). Rating-fill style: dots 1..value are amber,
// the rest muted. Tapping the current value clears it (mood is optional).
// Stateless/controlled; styling lives in the dc-journal- CSS block (globals.css).
export default function MoodDots({ value, onChange, size = 'md', ariaPrefix = 'Mood' }) {
  return (
    <div className={`journal-mood-dots${size === 'sm' ? ' sm' : ''}`} role="group" aria-label={ariaPrefix}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`journal-mood-dot${value != null && n <= value ? ' filled' : ''}`}
          aria-label={`${ariaPrefix} ${n}`}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? null : n)}
        />
      ))}
    </div>
  )
}
