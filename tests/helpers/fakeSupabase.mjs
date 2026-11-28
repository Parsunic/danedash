// An in-memory stand-in for the parts of Supabase the sync engine uses: the `app_state`
// table through supabase-js's query builder, Realtime broadcast channels, and (for legacy
// devices) postgres_changes.
//
// It behaves like the real thing where the protocol depends on it:
//   - updates filtered on `updated_at` are compare-and-swap (timestamps compared as
//     instants, the way Postgres compares timestamptz);
//   - timestamps come back in Postgres's `+00:00` format, not the `Z` the client sent;
//   - stored JSON has its object keys re-ordered, the way jsonb stores them;
//   - every response is serialised and counted, per device, so tests can assert on egress.
import { als, wait } from './env.mjs'

const LATENCY_MS = 4
const toMs = (ts) => (ts ? new Date(ts).getTime() : 0)
const pgTimestamp = (ms) => new Date(ms).toISOString().replace('Z', '+00:00')
const clone = (v) => JSON.parse(JSON.stringify(v))

function jsonb(v) {
  if (Array.isArray(v)) return v.map(jsonb)
  if (v && typeof v === 'object') {
    const out = {}
    Object.keys(v)
      .sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0))
      .forEach(k => { out[k] = jsonb(v[k]) })
    return out
  }
  return v
}

export const newStats = () => ({
  head: 0, full: 0, insert: 0, update: 0, casMiss: 0, bytes: 0, realtimeBytes: 0, signalBytes: 0,
})

export function createFakeSupabase() {
  const server = {
    rows: [],          // { key, data, updated_at }
    pgSubs: [],        // postgres_changes subscribers (legacy builds)
    bus: [],           // broadcast subscribers
    rejectInsert: null,
  }

  const row = (key) => server.rows.find(r => r.key === key)
  const rowSize = (key) => (row(key) ? JSON.stringify(row(key).data).length : 0)

  function putRow(key, data, ms = Date.now()) {
    const existing = row(key)
    const next = { key, data: jsonb(clone(data)), updated_at: pgTimestamp(ms) }
    if (existing) Object.assign(existing, next)
    else server.rows.push(next)
  }

  function emitPg(r) {
    for (const sub of server.pgSubs) {
      const payload = { new: clone(r) }
      sub.dev.stats.realtimeBytes += JSON.stringify(payload).length
      setTimeout(() => als.run(sub.ctx, () => sub.cb(payload)), LATENCY_MS)
    }
  }

  class Query {
    constructor(dev) {
      Object.assign(this, { dev, op: 'select', filters: [], cols: null, ret: null, ord: null, lim: null, one: null })
    }
    select(c) { if (this.op === 'select') this.cols = c; else this.ret = c; return this }
    insert(r) { this.op = 'insert'; this.row = r; return this }
    update(v) { this.op = 'update'; this.vals = v; return this }
    eq(col, v) { this.filters.push(r => (col === 'updated_at' ? toMs(r[col]) === toMs(v) : r[col] === v)); return this }
    in(col, arr) { this.filters.push(r => arr.includes(r[col])); return this }
    order(col, o) { this.ord = { col, asc: o?.ascending !== false }; return this }
    limit(n) { this.lim = n; return this }
    maybeSingle() { this.one = 'maybe'; return this }
    single() { this.one = 'single'; return this }
    then(res, rej) { return wait(LATENCY_MS).then(() => this.exec()).then(res, rej) }

    project(r, cols) {
      const o = {}
      cols.split(',').map(s => s.trim()).forEach(c => { o[c] = clone(r[c]) })
      return o
    }
    respond(data) {
      this.dev.stats.bytes += JSON.stringify(data ?? null).length
      return { data, error: null }
    }
    exec() {
      const st = this.dev.stats
      const match = server.rows.filter(r => this.filters.every(f => f(r)))
      if (this.op === 'select') {
        if (this.cols.includes('data')) st.full++
        else st.head++
        let rows = match.slice()
        if (this.ord) rows.sort((a, b) => (toMs(a[this.ord.col]) - toMs(b[this.ord.col])) * (this.ord.asc ? 1 : -1))
        if (this.lim) rows = rows.slice(0, this.lim)
        rows = rows.map(r => this.project(r, this.cols))
        if (this.one) {
          if (!rows.length) {
            return this.one === 'single'
              ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
              : this.respond(null)
          }
          return this.respond(rows[0])
        }
        return this.respond(rows)
      }
      if (this.op === 'insert') {
        st.insert++
        if (server.rejectInsert === this.row.key) {
          return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
        }
        if (row(this.row.key)) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
        const r = { key: this.row.key, data: jsonb(clone(this.row.data)), updated_at: pgTimestamp(toMs(this.row.updated_at)) }
        server.rows.push(r)
        emitPg(r)
        return this.respond(this.ret ? [this.project(r, this.ret)] : null)
      }
      if (this.op === 'update') {
        st.update++
        if (!match.length) st.casMiss++
        match.forEach(r => {
          if ('data' in this.vals) r.data = jsonb(clone(this.vals.data))
          if ('updated_at' in this.vals) r.updated_at = pgTimestamp(toMs(this.vals.updated_at))
          emitPg(r)
        })
        return this.respond(this.ret ? match.map(r => this.project(r, this.ret)) : null)
      }
      throw new Error(`fake supabase: unsupported op ${this.op}`)
    }
  }

  function channel(dev, topic, opts) {
    const self = opts?.config?.broadcast?.self === true
    const handlers = []
    const ctx = als.getStore()
    const ch = {
      on(type, filter, cb) { handlers.push({ type, filter, cb }); return ch },
      subscribe(cb) {
        for (const h of handlers) {
          if (h.type === 'postgres_changes') server.pgSubs.push({ dev, ctx, cb: h.cb })
          if (h.type === 'broadcast') server.bus.push({ dev, ctx, topic, event: h.filter?.event, cb: h.cb, ch })
        }
        if (cb) setTimeout(() => als.run(ctx, () => cb('SUBSCRIBED')), LATENCY_MS)
        return ch
      },
      send(msg) {
        for (const s of server.bus) {
          if (s.topic !== topic || s.event !== msg.event) continue
          if (s.ch === ch && !self) continue
          s.dev.stats.signalBytes += JSON.stringify(msg).length
          setTimeout(() => als.run(s.ctx, () => s.cb({ payload: clone(msg.payload) })), LATENCY_MS)
        }
        return Promise.resolve('ok')
      },
      unsubscribe() {
        server.bus = server.bus.filter(s => s.ch !== ch)
        server.pgSubs = server.pgSubs.filter(s => s.ctx !== ctx)
      },
    }
    return ch
  }

  const clientFor = (dev) => ({
    from: () => new Query(dev),
    channel: (topic, opts) => channel(dev, topic, opts),
    removeChannel: (ch) => ch.unsubscribe(),
  })

  return { server, row, rowSize, putRow, clientFor, pgTimestamp }
}
