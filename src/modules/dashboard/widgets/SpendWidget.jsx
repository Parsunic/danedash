import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  currentMonthKey, monthSummary, SPEND_CATEGORIES, categoryMeta, fmtMoney,
} from '../../finances/financeUtils.js'

// Dashboard spend widget (registry id 'spend'). Read-only mirror of this month's
// finance log — logging lives on /finances. Self-contained: reads finance:<month>
// + finance_budgets and re-reads on 'sync-applied'.
//   S: this-month spent big-number + vs-budget delta line.
//   M: + top-3 category mini bars.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, color: 'var(--text-primary)' }

function load() {
  return monthSummary(currentMonthKey())
}

export default function SpendWidget({ size }) {
  const [summary, setSummary] = useState(load)
  const refresh = useCallback(() => setSummary(load()), [])
  useEffect(() => {
    window.addEventListener('sync-applied', refresh)
    return () => window.removeEventListener('sync-applied', refresh)
  }, [refresh])

  const { spent, totalBudget, currency, count, byCategory } = summary

  // ── Empty ──
  if (count === 0 && spent === 0) {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Spend</div>
        <div style={{ ...HERO, color: 'var(--text-tertiary)', marginTop: 6 }}>{currency}0</div>
        <Link to="/finances" className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0, textDecoration: 'none' }}>
          Log spending →
        </Link>
      </div>
    )
  }

  const pct = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : null
  const over = totalBudget > 0 && spent > totalBudget
  const remaining = totalBudget > 0 ? totalBudget - spent : null

  const deltaLine = totalBudget > 0
    ? (over
        ? `${fmtMoney(spent - totalBudget, currency)} over budget`
        : `${fmtMoney(remaining, currency)} left of ${fmtMoney(totalBudget, currency)}`)
    : 'No budget set'

  const hero = (
    <>
      <div className="dash-widget-label">Spend</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={HERO}>{fmtMoney(spent, currency)}</span>
        {pct != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: over ? '#EF4444' : 'var(--text-secondary)' }}>
            {pct}%
          </span>
        )}
      </div>
      <div className="dash-widget-label" style={{ marginTop: 3 }}>this month</div>
    </>
  )

  // ── S ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        {hero}
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0, color: over ? '#EF4444' : undefined }}>
          {deltaLine}
        </div>
      </div>
    )
  }

  // ── M: + top-3 category mini bars ──
  const top = SPEND_CATEGORIES
    .map(c => ({ id: c.id, color: c.color, label: c.label, val: byCategory[c.id] || 0 }))
    .filter(c => c.val > 0)
    .sort((a, b) => b.val - a.val)
    .slice(0, 3)
  const maxVal = top.length ? Math.max(...top.map(c => c.val)) : 1

  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header" style={{ marginBottom: 6 }}>
        <span className="dash-widget-label">Spend</span>
        <Link to="/finances" className="dash-widget-link">Log →</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...HERO, fontSize: 34 }}>{fmtMoney(spent, currency)}</span>
        {pct != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: over ? '#EF4444' : 'var(--text-secondary)' }}>
            {deltaLine}
          </span>
        )}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {top.length === 0 ? (
          <div className="dash-widget-empty" style={{ padding: 0 }}>No spending yet.</div>
        ) : top.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(250,250,250,0.4)', width: 62, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {categoryMeta(c.id).label}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ width: `${(c.val / maxVal) * 100}%`, height: '100%', background: c.color, borderRadius: 3 }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
              {fmtMoney(c.val, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
