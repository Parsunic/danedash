import { supabase } from '../../lib/supabase.js'
import { getClientId, getClientSecret } from '../../lib/api/gcalendar.js'
import {
  getGfitAccessToken, getGfitRefreshToken, getGfitTokenExpiry,
  setGfitTokens, clearGfitTokens, isGfitConnected,
  getGfitLastSync, setGfitLastSync,
} from '../../lib/api/googlefit.js'

const GFIT_BASE      = 'https://www.googleapis.com/fitness/v1/users/me'
const GOOGLE_TOKEN   = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH    = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_ID        = 'dane'
const SYNC_INTERVAL  = 60 * 60 * 1000  // sync at most once per hour on tab open

const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
].join(' ')

// ── PKCE helpers (same pattern as googleSync.js / fitbitSync.js) ──

function generateCodeVerifier() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateCodeChallenge(verifier) {
  const enc  = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ── OAuth flow ──

export async function initiateGoogleFitOAuth() {
  const clientId = getClientId()
  if (!clientId) { console.error('[GFit] No OAuth client ID — configure it in Settings'); return }

  const verifier  = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)

  // Key distinct from gcal_code_verifier so the callback handler can tell them apart
  localStorage.setItem('googlefit_code_verifier', verifier)

  const redirectUri = window.location.origin
  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          redirectUri,
    response_type:         'code',
    scope:                 SCOPES,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    access_type:           'offline',
    prompt:                'consent',
  })
  window.location.href = `${GOOGLE_AUTH}?${params}`
}

export async function handleGoogleFitCallback() {
  const params = new URLSearchParams(window.location.search)
  const code   = params.get('code')
  const error  = params.get('error')

  if (!code) {
    if (error) console.error('[GFit] OAuth error:', error)
    return false
  }

  const verifier = localStorage.getItem('googlefit_code_verifier')
  localStorage.removeItem('googlefit_code_verifier')

  if (!verifier) {
    console.error('[GFit] Missing code verifier — Safari may have cleared storage')
    window.history.replaceState({}, '', '/')
    return false
  }

  const clientId     = getClientId()
  const clientSecret = getClientSecret()
  const redirectUri  = window.location.origin

  try {
    const resp = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier:  verifier,
        client_id:      clientId,
        client_secret:  clientSecret,
        redirect_uri:   redirectUri,
        grant_type:     'authorization_code',
      }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      console.error('[GFit] Token exchange failed:', resp.status, err)
      window.history.replaceState({}, '', '/')
      return false
    }

    const data = await resp.json()
    setGfitTokens({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
    })
    persistTokensToSupabase(data.access_token, data.refresh_token, data.expires_in)
    window.dispatchEvent(new Event('gfit-connected'))
    console.log('[GFit] Connected')
    return true
  } catch (e) {
    console.error('[GFit] Token exchange threw:', e)
    window.history.replaceState({}, '', '/')
    return false
  }
}

// ── Token management ──

async function refreshGfitToken() {
  const refreshToken = getGfitRefreshToken()
  const clientId     = getClientId()
  const clientSecret = getClientSecret()
  if (!refreshToken || !clientId) {
    clearGfitTokens()
    window.dispatchEvent(new Event('gfit-disconnected'))
    return null
  }

  try {
    const resp = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    })
    if (!resp.ok) throw new Error(`refresh ${resp.status}`)
    const data = await resp.json()
    setGfitTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in })
    persistTokensToSupabase(data.access_token, data.refresh_token ?? refreshToken, data.expires_in)
    return data.access_token
  } catch {
    clearGfitTokens()
    window.dispatchEvent(new Event('gfit-disconnected'))
    return null
  }
}

async function getValidGfitToken() {
  if (Date.now() < getGfitTokenExpiry() - 2 * 60 * 1000) return getGfitAccessToken()
  return refreshGfitToken()
}

async function gfitRequest(method, path, body) {
  let token = await getValidGfitToken()
  if (!token) return null

  const makeOpts = (t) => ({
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  let resp = await fetch(`${GFIT_BASE}${path}`, makeOpts(token))

  if (resp.status === 401) {
    token = await refreshGfitToken()
    if (!token) return null
    resp = await fetch(`${GFIT_BASE}${path}`, makeOpts(token))
  }

  if (resp.status === 404) return null  // data source not available for this user
  if (!resp.ok) { console.error('[GFit] API error:', resp.status, path); return null }
  return resp.json()
}

// ── Supabase token persistence (cross-device sync) ──

function persistTokensToSupabase(accessToken, refreshToken, expiresIn) {
  supabase.from('user_integrations').upsert({
    user_id:       USER_ID,
    provider:      'googlefit',
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_at:    new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes:        SCOPES,
  }, { onConflict: 'user_id,provider' }).then(({ error }) => {
    if (error) console.warn('[GFit] Could not persist tokens to Supabase:', error.message)
  })
}

export async function loadTokensFromSupabase() {
  if (isGfitConnected()) return
  try {
    const { data } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', USER_ID)
      .eq('provider', 'googlefit')
      .single()

    if (data?.access_token) {
      const expiresIn = Math.max(0, (new Date(data.expires_at).getTime() - Date.now()) / 1000)
      setGfitTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: expiresIn })
      window.dispatchEvent(new Event('gfit-connected'))
    }
  } catch {}
}

// ── Data helpers ──

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Day bounds in ms (local time) for the aggregate API
function dayBoundsMs(date) {
  const startMs = new Date(date + 'T00:00:00').getTime()
  const endMs   = new Date(date + 'T23:59:59.999').getTime()
  return { startMs, endMs }
}

// Sleep window: previous evening → current day noon (catches overnight sleep)
function sleepWindowMs(date) {
  const prev = new Date(date + 'T00:00:00')
  prev.setDate(prev.getDate() - 1)
  const startMs = new Date(prev.toISOString().slice(0, 10) + 'T20:00:00').getTime()
  const endMs   = new Date(date + 'T12:00:00').getTime()
  return { startMs, endMs }
}

function nsToMs(ns) { return Math.round(Number(ns) / 1_000_000) }

// ── Google Fit data parsers ──

function parseAggregate(data) {
  if (!data?.bucket?.[0]?.dataset) return {}
  const result = {}

  for (const ds of data.bucket[0].dataset) {
    const id = ds.dataSourceId ?? ''

    // Sum steps across all points in the bucket
    if (id.includes('step_count')) {
      result.steps = ds.point?.reduce((sum, p) => sum + (p.value?.[0]?.intVal ?? 0), 0) ?? null
    }

    // Active minutes — sum all points
    if (id.includes('active_minutes') || id.includes('moveMinutes')) {
      result.activeMinutes = ds.point?.reduce((sum, p) => sum + (p.value?.[0]?.intVal ?? 0), 0) ?? null
    }

    // Resting HR — minimum fpVal across all readings (best proxy without explicit resting HR metric)
    if (id.includes('heart_rate.bpm') && ds.point?.length) {
      const readings = ds.point.flatMap(p => p.value?.map(v => v.fpVal) ?? []).filter(Boolean)
      if (readings.length) result.restingHr = Math.round(Math.min(...readings))
    }
  }

  return result
}

function parseSleepSegments(data, sessionStartMs, sessionEndMs) {
  if (!data?.point?.length) return null

  const stageDurations = { deep: 0, light: 0, rem: 0, wake: 0 }

  for (const pt of data.point) {
    const ptStart = nsToMs(pt.startTimeNanos)
    const ptEnd   = nsToMs(pt.endTimeNanos)
    if (ptEnd <= sessionStartMs || ptStart >= sessionEndMs) continue

    const durationMin = Math.round((Math.min(ptEnd, sessionEndMs) - Math.max(ptStart, sessionStartMs)) / 60_000)
    const type = pt.value?.[0]?.intVal ?? 0

    // Google Fit sleep segment types
    // 1=Awake, 2=Asleep(generic), 3=OutOfBed, 4=Light, 5=Deep, 6=REM
    if      (type === 5) stageDurations.deep  += durationMin
    else if (type === 6) stageDurations.rem   += durationMin
    else if (type === 4 || type === 2) stageDurations.light += durationMin
    else if (type === 1 || type === 3) stageDurations.wake  += durationMin
  }

  return stageDurations
}

function parseHRV(data) {
  if (!data?.point?.length) return null
  // Google Fit HRV is RMSSD in ms — take daily average
  const vals = data.point.flatMap(p => p.value?.map(v => v.fpVal) ?? []).filter(Boolean)
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
}

// ── Main sync function ──

export async function syncGfitData(date = todayStr()) {
  if (!isGfitConnected()) return null
  emitStatus('syncing')

  try {
    const { startMs, endMs } = dayBoundsMs(date)
    const { startMs: sleepStart, endMs: sleepEnd } = sleepWindowMs(date)

    // Parallel fetch: aggregate metrics + sleep sessions + HRV
    const sleepStartIso = new Date(sleepStart).toISOString()
    const sleepEndIso   = new Date(sleepEnd).toISOString()
    const sleepStartNs  = String(sleepStart * 1_000_000)
    const sleepEndNs    = String(sleepEnd   * 1_000_000)
    const dayStartNs    = String(startMs    * 1_000_000)
    const dayEndNs      = String(endMs      * 1_000_000)

    const [aggregateData, sleepSessions, sleepSegmentData, hrvData] = await Promise.all([
      // Steps + heart rate + active minutes for the day
      gfitRequest('POST', '/dataset:aggregate', {
        aggregateBy: [
          { dataTypeName: 'com.google.step_count.delta' },
          { dataTypeName: 'com.google.heart_rate.bpm' },
          { dataTypeName: 'com.google.active_minutes' },
        ],
        bucketByTime:    { durationMillis: endMs - startMs + 1 },
        startTimeMillis: String(startMs),
        endTimeMillis:   String(endMs),
      }),

      // Sleep sessions (activityType 72 = sleep)
      gfitRequest('GET', `/sessions?startTime=${sleepStartIso}&endTime=${sleepEndIso}&activityType=72`),

      // Sleep stage segments from the merged derived source
      gfitRequest('GET', `/dataSources/derived:com.google.sleep.segment:com.google.android.gms:merged/datasets/${sleepStartNs}-${sleepEndNs}`),

      // HRV — may be 404 / empty if device doesn't record it
      gfitRequest('GET', `/dataSources/derived:com.google.heart_rate.variability:com.google.android.gms:merged/datasets/${dayStartNs}-${dayEndNs}`),
    ])

    // Parse aggregate (steps, resting HR, active minutes)
    const { steps, restingHr, activeMinutes } = parseAggregate(aggregateData)

    // Parse sleep
    let sleepScore  = null
    let sleepStages = null

    const mainSession = sleepSessions?.session?.sort((a, b) =>
      parseInt(b.endTimeMillis) - parseInt(b.startTimeMillis) -
      (parseInt(a.endTimeMillis) - parseInt(a.startTimeMillis))
    )[0] ?? null  // longest session = main sleep

    if (mainSession) {
      const sessStartMs = parseInt(mainSession.startTimeMillis)
      const sessEndMs   = parseInt(mainSession.endTimeMillis)
      const stages      = parseSleepSegments(sleepSegmentData, sessStartMs, sessEndMs)

      if (stages) {
        sleepStages = {
          ...stages,
          startTime: new Date(sessStartMs).toISOString(),
          endTime:   new Date(sessEndMs).toISOString(),
        }
        const timeAsleep = stages.deep + stages.light + stages.rem
        const totalTime  = timeAsleep + stages.wake
        sleepScore = totalTime > 0 ? Math.round((timeAsleep / totalTime) * 100) : null
      } else {
        // Session exists but no granular segment data — compute from session duration
        const sessionMin = Math.round((sessEndMs - sessStartMs) / 60_000)
        sleepStages = { deep: 0, light: sessionMin, rem: 0, wake: 0,
          startTime: new Date(sessStartMs).toISOString(),
          endTime:   new Date(sessEndMs).toISOString() }
        sleepScore = 75  // reasonable default when stages not available
      }
    }

    const hrv = parseHRV(hrvData)

    const { error } = await supabase
      .from('health_metrics')
      .upsert({
        user_id:         USER_ID,
        date,
        sleep_score:     sleepScore,
        sleep_stages:    sleepStages,
        hrv,
        resting_hr:      restingHr ?? null,
        steps:           steps    ?? null,
        active_minutes:  activeMinutes ?? null,
        raw_fitbit_data: { aggregateData, sleepSessions, sleepSegmentData, hrvData },
      }, { onConflict: 'user_id,date' })

    if (error) { console.error('[GFit] Supabase write failed:', error); emitStatus('error'); return null }

    const now = new Date().toISOString()
    setGfitLastSync(now)
    emitStatus('synced', now)
    return { date, sleep_score: sleepScore, sleep_stages: sleepStages, hrv, resting_hr: restingHr, steps, active_minutes: activeMinutes }
  } catch (e) {
    console.error('[GFit] Sync error:', e)
    emitStatus('error')
    return null
  }
}

export async function syncTodayIfStale() {
  if (!isGfitConnected()) return
  const last = getGfitLastSync()
  if (last && Date.now() - new Date(last).getTime() < SYNC_INTERVAL) return
  return syncGfitData()
}

export async function fetchHealthHistory(days = 7) {
  const oldest = new Date()
  oldest.setDate(oldest.getDate() - (days - 1))
  const oldestStr = oldest.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('health_metrics')
    .select('date, sleep_score, sleep_stages, hrv, resting_hr, steps, active_minutes')
    .eq('user_id', USER_ID)
    .gte('date', oldestStr)
    .order('date', { ascending: true })

  if (error) { console.error('[GFit] History fetch error:', error); return [] }
  return data ?? []
}

function emitStatus(status, lastSync = null) {
  window.dispatchEvent(new CustomEvent('gfit-sync-status', { detail: { status, lastSync } }))
}
