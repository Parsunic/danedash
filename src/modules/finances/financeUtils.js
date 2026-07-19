import { storeGet, storeSet } from '../../lib/storage.js'

// ── Finances data layer ──────────────────────────────────────────────────────
// Transactions are stored one array per month at key `finance:YYYY-MM`:
//   [{ id, date:'YYYY-MM-DD', amount:Number(>0), type:'expense'|'income', category, note? }]
// Budgets live in a single static blob at `finance_budgets`:
//   { v:1, monthlyBudgets: { [category]: Number }, currency:'$' }
// Both are wired into cross-device sync (DYNAMIC_SYNC_PREFIXES 'finance:' +
// STATIC_SYNC_KEYS 'finance_budgets'). No boot writes: an absent key resolves to
// in-memory defaults; storeSet fires only on a real user gesture.

export const BUDGETS_KEY = 'finance_budgets'
export const monthTxKey = (monthKey) => `finance:${monthKey}`

// ── Fixed category taxonomy ──
// `income` is both a type and its own category. Everything else is a spend bucket.
export const CATEGORIES = [
  { id: 'food',          label: 'Food',          color: '#E8A020' },
  { id: 'transport',     label: 'Transport',     color: '#6395F2' },
  { id: 'shopping',      label: 'Shopping',       color: '#C792EA' },
  { id: 'subscriptions', label: 'Subscriptions', color: '#7048E8' },
  { id: 'entertainment', label: 'Entertainment', color: '#E85D9E' },
  { id: 'health',        label: 'Health',        color: '#33C4B3' },
  { id: 'school',        label: 'School',        color: '#F2C063' },
  { id: 'other',         label: 'Other',         color: '#868E96' },
  { id: 'income',        label: 'Income',        color: '#6BE3A4' },
]

// Spend buckets only (everything except income) — drives budgets + the picker.
export const SPEND_CATEGORIES = CATEGORIES.filter(c => c.id !== 'income')

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))
export function categoryMeta(id) {
  return CAT_BY_ID[id] || { id: id || 'other', label: id || 'Other', color: '#868E96' }
}

// ── Month-key helpers ──
function pad2(n) { return String(n).padStart(2, '0') }

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthKeyOf(dateStr) {
  return (dateStr || '').slice(0, 7)
}

export function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, (m - 1) + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function isCurrentMonth(monthKey) {
  return monthKey === currentMonthKey()
}

// ── Money formatting ──
export function fmtMoney(n, currency = '$') {
  const num = Number(n) || 0
  const neg = num < 0
  const abs = Math.abs(num)
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${neg ? '-' : ''}${currency}${s}`
}

// ── Transactions ──
export function getMonthTx(monthKey) {
  const arr = storeGet(monthTxKey(monthKey))
  return Array.isArray(arr) ? arr : []
}

// Add a transaction. Derives its month key from the transaction date so it always
// lands in the correct bucket. One storeSet on that month key. Returns the stored tx.
export function addTx({ date, amount, type, category, note }) {
  const d = date || todayISO()
  const tx = {
    id: (crypto.randomUUID ? crypto.randomUUID() : `fin-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    date: d,
    amount: Math.abs(Number(amount) || 0),
    type: type === 'income' ? 'income' : 'expense',
    category: type === 'income' ? 'income' : (category || 'other'),
    ...(note && note.trim() ? { note: note.trim() } : {}),
  }
  const key = monthTxKey(monthKeyOf(d))
  const arr = storeGet(key)
  const next = Array.isArray(arr) ? [...arr, tx] : [tx]
  storeSet(key, next)
  return tx
}

export function deleteTx(monthKey, id) {
  const key = monthTxKey(monthKey)
  const arr = storeGet(key)
  if (!Array.isArray(arr)) return
  storeSet(key, arr.filter(t => t.id !== id))
}

// ── Budgets ──
export function getBudgets() {
  const b = storeGet(BUDGETS_KEY)
  if (!b || typeof b !== 'object') return { v: 1, monthlyBudgets: {}, currency: '$' }
  return {
    v: 1,
    monthlyBudgets: (b.monthlyBudgets && typeof b.monthlyBudgets === 'object') ? b.monthlyBudgets : {},
    currency: b.currency || '$',
  }
}

export function setBudgets(next) {
  const cur = getBudgets()
  storeSet(BUDGETS_KEY, {
    v: 1,
    monthlyBudgets: next.monthlyBudgets ?? cur.monthlyBudgets,
    currency: next.currency ?? cur.currency,
  })
}

// Update a single category budget (user gesture — one storeSet).
export function setCategoryBudget(category, amount) {
  const cur = getBudgets()
  const monthlyBudgets = { ...cur.monthlyBudgets }
  const n = Number(amount)
  if (!n || n <= 0) delete monthlyBudgets[category]
  else monthlyBudgets[category] = n
  storeSet(BUDGETS_KEY, { v: 1, monthlyBudgets, currency: cur.currency })
}

export function totalBudget(budgets = getBudgets()) {
  return SPEND_CATEGORIES.reduce((s, c) => s + (Number(budgets.monthlyBudgets[c.id]) || 0), 0)
}

// ── Month summary ──
// Returns { spent, income, net, byCategory, totalBudget, budgetComparison, currency }.
// byCategory only accumulates expense buckets; budgetComparison pairs each spend
// bucket's total against its budget with a share (pct of budget).
export function monthSummary(monthKey) {
  const tx = getMonthTx(monthKey)
  const budgets = getBudgets()
  let spent = 0
  let income = 0
  const byCategory = {}
  for (const t of tx) {
    const amt = Math.abs(Number(t.amount) || 0)
    if (t.type === 'income') {
      income += amt
    } else {
      spent += amt
      byCategory[t.category] = (byCategory[t.category] || 0) + amt
    }
  }
  const tot = totalBudget(budgets)
  const budgetComparison = {}
  for (const c of SPEND_CATEGORIES) {
    const catSpent = byCategory[c.id] || 0
    const budget = Number(budgets.monthlyBudgets[c.id]) || 0
    budgetComparison[c.id] = {
      spent: catSpent,
      budget,
      pct: budget > 0 ? catSpent / budget : (catSpent > 0 ? Infinity : 0),
    }
  }
  return {
    spent,
    income,
    net: income - spent,
    byCategory,
    totalBudget: tot,
    budgetComparison,
    currency: budgets.currency,
    count: tx.length,
  }
}

// Transactions grouped by day, newest day first, newest-within-day first.
export function txByDay(monthKey) {
  const tx = getMonthTx(monthKey)
  const groups = {}
  for (const t of tx) {
    (groups[t.date] ||= []).push(t)
  }
  return Object.keys(groups)
    .sort((a, b) => (a < b ? 1 : -1))
    .map(date => ({
      date,
      items: groups[date].slice().reverse(),
      total: groups[date].reduce((s, t) => s + (t.type === 'income' ? 0 : Math.abs(Number(t.amount) || 0)), 0),
    }))
}

export function fmtDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = todayISO()
  if (dateStr === today) return 'Today'
  const yd = new Date(); yd.setDate(yd.getDate() - 1)
  const ydStr = `${yd.getFullYear()}-${pad2(yd.getMonth() + 1)}-${pad2(yd.getDate())}`
  if (dateStr === ydStr) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
