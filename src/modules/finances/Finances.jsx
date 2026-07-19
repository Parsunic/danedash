import { useState, useEffect, useCallback, useMemo } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { useFlip, FlipTitle } from '../../components/FlipSwitch.jsx'
import {
  CATEGORIES, SPEND_CATEGORIES, categoryMeta,
  currentMonthKey, shiftMonthKey, monthLabel, isCurrentMonth, todayISO,
  fmtMoney, addTx, deleteTx, getBudgets, setCategoryBudget,
  monthSummary, txByDay, fmtDayLabel,
} from './financeUtils.js'

// ── Icons ──
function LogIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2h9l4 4v16l-2.2-1.3L14.6 22 12 20.6 9.4 22 7.2 20.7 5 22V4a2 2 0 0 1 1-2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  )
}
function BudgetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
      <circle cx="16.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ── Category bar chart tooltip ──
function ChartTip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="chart-tooltip-glass">
      <div className="chart-tooltip-label">{p.label}</div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-name" style={{ color: p.color }}>Spent</span>
        <span className="chart-tooltip-value">{fmtMoney(p.spent, currency)}</span>
      </div>
      {p.budget > 0 && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name" style={{ color: 'rgba(255,255,255,0.35)' }}>Budget</span>
          <span className="chart-tooltip-value">{fmtMoney(p.budget, currency)}</span>
        </div>
      )}
    </div>
  )
}

// ── Single transaction row ──
function TxRow({ tx, currency, confirming, onAskDelete, onConfirmDelete, onCancelDelete }) {
  const meta = categoryMeta(tx.category)
  const isIncome = tx.type === 'income'
  return (
    <div className="fin-tx-row">
      <span className="fin-tx-dot" style={{ background: meta.color }} />
      <div className="fin-tx-body">
        <span className="fin-tx-cat">{meta.label}</span>
        {tx.note && <span className="fin-tx-note">{tx.note}</span>}
      </div>
      {confirming ? (
        <div className="fin-tx-confirm">
          <span className="fin-tx-confirm-q">Delete?</span>
          <button className="fin-icon-btn danger" onClick={onConfirmDelete} aria-label="Confirm delete">✓</button>
          <button className="fin-icon-btn" onClick={onCancelDelete} aria-label="Cancel">✕</button>
        </div>
      ) : (
        <>
          <span className={`fin-tx-amount${isIncome ? ' income' : ''}`}>
            {isIncome ? '+' : ''}{fmtMoney(tx.amount, currency)}
          </span>
          <button className="fin-icon-btn subtle" onClick={onAskDelete} aria-label="Delete transaction">✕</button>
        </>
      )}
    </div>
  )
}

// ── Budgets face row ──
function BudgetRow({ cat, spent, budget, currency, onCommit }) {
  const [draft, setDraft] = useState(budget ? String(budget) : '')
  useEffect(() => { setDraft(budget ? String(budget) : '') }, [budget])
  const pct = budget > 0 ? spent / budget : (spent > 0 ? Infinity : 0)
  const over = pct > 1
  const barPct = budget > 0 ? Math.min(pct, 1) * 100 : 0
  return (
    <div className="fin-budget-row">
      <div className="fin-budget-head">
        <span className="fin-tx-dot" style={{ background: cat.color }} />
        <span className="fin-budget-name">{cat.label}</span>
        <span className="fin-budget-spent">
          {fmtMoney(spent, currency)}{budget > 0 ? ` / ${fmtMoney(budget, currency)}` : ''}
        </span>
        <div className="fin-budget-input-wrap">
          <span className="fin-budget-input-prefix">{currency}</span>
          <input
            className="fin-budget-input"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => onCommit(cat.id, draft)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        </div>
      </div>
      <div className="fin-budget-bar-track">
        <div
          className="fin-budget-bar-fill"
          style={{ width: `${barPct}%`, background: over ? '#EF4444' : 'var(--accent)' }}
        />
      </div>
      {over && budget > 0 && (
        <div className="fin-budget-over">Over by {fmtMoney(spent - budget, currency)}</div>
      )}
    </div>
  )
}

export default function Finances() {
  const { flipped, animState, isFlipping, flip } = useFlip(false)
  const view = flipped ? 'budgets' : 'log'

  const [monthKey, setMonthKey] = useState(() => currentMonthKey())

  // Data snapshots for the viewed month — re-read on month change + remote sync.
  const [days, setDays] = useState(() => txByDay(monthKey))
  const [summary, setSummary] = useState(() => monthSummary(monthKey))
  const [budgets, setBudgets] = useState(() => getBudgets())

  const reload = useCallback((mk = monthKey) => {
    setDays(txByDay(mk))
    setSummary(monthSummary(mk))
    setBudgets(getBudgets())
  }, [monthKey])

  useEffect(() => { reload(monthKey) }, [monthKey, reload])

  // Cross-device pull applied → re-read from localStorage (see SyncContext).
  useEffect(() => {
    const onSync = () => reload(monthKey)
    window.addEventListener('sync-applied', onSync)
    return () => window.removeEventListener('sync-applied', onSync)
  }, [monthKey, reload])

  // ── Quick-add form ──
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('expense')
  const [category, setCategory] = useState('food')
  const [note, setNote] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  const currency = summary.currency
  const amtNum = parseFloat(amount)
  const canAdd = !isNaN(amtNum) && amtNum > 0

  const handleAdd = useCallback(() => {
    if (!canAdd) return
    const date = isCurrentMonth(monthKey) ? todayISO() : `${monthKey}-01`
    addTx({ date, amount: amtNum, type, category, note })
    setAmount('')
    setNote('')
    setConfirmId(null)
    reload(monthKey)
  }, [canAdd, amtNum, type, category, note, monthKey, reload])

  const handleDelete = useCallback((id) => {
    deleteTx(monthKey, id)
    setConfirmId(null)
    reload(monthKey)
  }, [monthKey, reload])

  const commitBudget = useCallback((catId, raw) => {
    setCategoryBudget(catId, raw)
    setBudgets(getBudgets())
    setSummary(monthSummary(monthKey))
  }, [monthKey])

  const prevMonth = () => setMonthKey(mk => shiftMonthKey(mk, -1))
  const nextMonth = () => setMonthKey(mk => shiftMonthKey(mk, +1))

  const totalPct = summary.totalBudget > 0 ? Math.round((summary.spent / summary.totalBudget) * 100) : null
  const overTotal = summary.totalBudget > 0 && summary.spent > summary.totalBudget

  const chartData = useMemo(() => {
    return SPEND_CATEGORIES
      .map(c => ({
        label: c.label,
        short: c.label.slice(0, 4),
        color: c.color,
        spent: summary.byCategory[c.id] || 0,
        budget: Number(budgets.monthlyBudgets[c.id]) || 0,
      }))
      .filter(d => d.spent > 0 || d.budget > 0)
  }, [summary, budgets])

  const budgetTotal = useMemo(
    () => SPEND_CATEGORIES.reduce((s, c) => s + (Number(budgets.monthlyBudgets[c.id]) || 0), 0),
    [budgets]
  )

  return (
    <div className="fin-page">
      <BackgroundBlob page="finances" />

      {/* ── Header ── */}
      <div className="fin-page-header">
        <div>
          <h1 className="fin-title">Finances</h1>
          <div className="page-subtitle">Every dollar has a job</div>
        </div>
      </div>

      {/* ── View flip: Log ⇄ Budgets ── */}
      <div className="fin-flip-header">
        <FlipTitle
          icon={view === 'log' ? <LogIcon /> : <BudgetIcon />}
          label={view === 'log' ? 'Log' : 'Budgets'}
          isFlipping={isFlipping}
          onClick={() => flip()}
          title={view === 'log' ? 'Switch to Budgets' : 'Switch to Log'}
        />
      </div>

      {/* ── Month nav ── */}
      <div className="fin-month-nav">
        <button className="fin-icon-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
        <span className="fin-month-label">{monthLabel(monthKey)}</span>
        <button
          className="fin-icon-btn"
          onClick={nextMonth}
          aria-label="Next month"
          disabled={isCurrentMonth(monthKey)}
        >›</button>
      </div>

      <div className={`flip-content fin-flip-content${animState ? ' ' + animState : ''}`}>
        {view === 'log' ? (
          /* ══ LOG FACE ══ */
          <div className="fin-log-face">
            {/* Quick add */}
            <div className="fin-card fin-quickadd">
              <div className="fin-amount-wrap">
                <span className="fin-amount-currency">{currency}</span>
                <input
                  className="fin-amount-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
                  aria-label="Amount"
                />
              </div>

              <div className="fin-type-toggle">
                <button
                  className={type === 'expense' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setType('expense')}
                >Expense</button>
                <button
                  className={type === 'income' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setType('income')}
                >Income</button>
              </div>

              {type === 'expense' ? (
                <div className="fin-chip-row">
                  {SPEND_CATEGORIES.map(c => (
                    <button
                      key={c.id}
                      className={`fin-chip${category === c.id ? ' active' : ''}`}
                      style={category === c.id ? { borderColor: c.color, color: c.color } : undefined}
                      onClick={() => setCategory(c.id)}
                    >
                      <span className="fin-chip-dot" style={{ background: c.color }} />
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="fin-income-hint">
                  <span className="fin-chip-dot" style={{ background: categoryMeta('income').color }} />
                  Logged as income
                </div>
              )}

              <div className="fin-add-row">
                <input
                  className="fin-note-input"
                  type="text"
                  placeholder="Note (optional)"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
                />
                <button className="btn-primary fin-add-btn" onClick={handleAdd} disabled={!canAdd}>Add</button>
              </div>
            </div>

            {/* Summary strip */}
            <div className="fin-card fin-summary">
              <div className="fin-summary-main">
                <div className="fin-summary-big">{fmtMoney(summary.spent, currency)}</div>
                <div className="dash-widget-label">spent this month</div>
              </div>
              {summary.totalBudget > 0 ? (
                <div className="fin-summary-budget">
                  <div className="fin-budget-bar-track">
                    <div
                      className="fin-budget-bar-fill"
                      style={{
                        width: `${Math.min(summary.spent / summary.totalBudget, 1) * 100}%`,
                        background: overTotal ? '#EF4444' : 'var(--accent)',
                      }}
                    />
                  </div>
                  <div className="fin-summary-budget-line">
                    {fmtMoney(summary.spent, currency)} of {fmtMoney(summary.totalBudget, currency)}
                    {totalPct != null && <span className="fin-summary-pct"> · {totalPct}%</span>}
                  </div>
                </div>
              ) : (
                <div className="fin-summary-budget-line muted">No budget set — flip to Budgets</div>
              )}
              <div className="fin-summary-foot">
                <span className="fin-summary-stat">
                  <span className="fin-summary-stat-label">Income</span>
                  <span className="fin-summary-stat-val income">{fmtMoney(summary.income, currency)}</span>
                </span>
                <span className="fin-summary-stat">
                  <span className="fin-summary-stat-label">Net</span>
                  <span className={`fin-summary-stat-val${summary.net >= 0 ? ' income' : ' neg'}`}>
                    {fmtMoney(summary.net, currency)}
                  </span>
                </span>
              </div>
            </div>

            {/* Transaction list */}
            {days.length === 0 ? (
              <div className="fin-empty">
                <div className="fin-empty-line">Every dollar has a job.</div>
                <div className="fin-empty-sub">Add your first transaction above.</div>
              </div>
            ) : (
              days.map(group => (
                <div key={group.date} className="fin-day-group">
                  <div className="fin-day-header">
                    <span className="fin-day-label">{fmtDayLabel(group.date)}</span>
                    <span className="fin-day-total">{fmtMoney(group.total, currency)}</span>
                  </div>
                  <div className="fin-card fin-day-card">
                    {group.items.map(tx => (
                      <TxRow
                        key={tx.id}
                        tx={tx}
                        currency={currency}
                        confirming={confirmId === tx.id}
                        onAskDelete={() => setConfirmId(tx.id)}
                        onConfirmDelete={() => handleDelete(tx.id)}
                        onCancelDelete={() => setConfirmId(null)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* ══ BUDGETS FACE ══ */
          <div className="fin-budgets-face">
            {/* Total-budget hero */}
            <div className="fin-card fin-budget-hero">
              <div className="dash-widget-label">Monthly budget</div>
              <div className="fin-summary-big">{fmtMoney(budgetTotal, currency)}</div>
              <div className="fin-budget-hero-sub">
                {budgetTotal > 0
                  ? `${fmtMoney(summary.spent, currency)} spent · ${fmtMoney(Math.max(budgetTotal - summary.spent, 0), currency)} left`
                  : 'Set a budget per category below.'}
              </div>
            </div>

            {/* Per-category bar chart */}
            {chartData.length > 0 && (
              <div className="fin-card fin-chart-card">
                <div className="fin-chart-header">
                  <span className="dash-widget-label">This month by category</span>
                </div>
                <ResponsiveContainer width="100%" height={168}>
                  <BarChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                    <XAxis
                      dataKey="short"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.32)', fontSize: 9.5, fontFamily: 'Geist Mono, monospace' }}
                      interval={0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.28)', fontSize: 9.5, fontFamily: 'Geist Mono, monospace' }}
                      tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                      width={44}
                    />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip currency={currency} />} />
                    <Bar dataKey="spent" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={650} animationEasing="ease-out">
                      {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Per-category budget rows */}
            <div className="fin-budget-list">
              {SPEND_CATEGORIES.map(c => (
                <BudgetRow
                  key={c.id}
                  cat={c}
                  spent={summary.byCategory[c.id] || 0}
                  budget={Number(budgets.monthlyBudgets[c.id]) || 0}
                  currency={currency}
                  onCommit={commitBudget}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
