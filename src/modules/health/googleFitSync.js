import { supabase } from '../../lib/supabase.js'
import { getClientId, getClientSecret } from '../../lib/api/gcalendar.js'
import {
  getGfitAccessToken, getGfitRefreshToken, getGfitTokenExpiry,
  setGfitTokens, clearGfitTokens, isGfitConnected,
  getGfitLastSync, setGfitLastSync,
} from '../../lib/api/googlefit.js'

const HEALTH_BASE   = 'https://health.googleapis.com/v4/users/me'
const GOOGLE_TOKEN  = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH   = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_ID       = 'dane'
const SYNC_INTERVAL = 60 * 60 * 1000

const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
].join(' ')

// ── PKCE helpers ──

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
  if (!clientId) { console.error('[Health] No OAuth client ID — configure it in Settings'); return }

  // Clear stale tokens so the user is prompted for the new googlehealth.* scopes
  // instead of silently reusing a cached session with the old fitness.* scopes.
  localStorage.removeItem('gfit_access_token')
  localStorage.removeItem('gfit_refresh_token')

  const verifier  = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
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
    if (error) console.error('[Health] OAuth error:', error)
    return false
  }

  const verifier = localStorage.getItem('googlefit_code_verifier')
  localStorage.removeItem('googlefit_code_verifier')

  if (!verifier) {
    console.error('[Health] Missing code verifier — Safari may have cleared storage')
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
      console.error('[Health] Token exchange failed:', resp.status, err)
      window.history.replaceState({}, '', '/')
      return false
    }

    const data = await resp.json()
    setGfitTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in })
    persistTokensToSupabase(data.access_token, data.refresh_token, data.expires_in)
    window.dispatchEvent(new Event('gfit-connected'))
    console.log('[Health] Connected to Google Health')
    return true
  } catch (e) {
    console.error('[Health] Token exchange threw:', e)
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

// ── HTTP helper with 401 retry ──

async function healthRequest(method, url, body, isRetry = false) {
  let token = await getValidGfitToken()
  if (!token) return null

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (resp.status === 401 && !isRetry) {
    const fresh = await refreshGfitToken()
    if (!fresh) return null
    return healthRequest(method, url, body, true)
  }

  if (!resp.ok) {
    console.error(`[Health] ${method} ${url} → ${resp.status}`)
    return null
  }
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
    if (error) console.warn('[Health] Could not persist tokens to Supabase:', error.message)
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

// ── Date helpers ──

function parseCivilDate(civilTime) {
  const d = civilTime?.date
  if (!d?.year || !d?.month || !d?.day) return null
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

function dateToRangeObj(dateStr, isEnd = false) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return isEnd
    ? { date: { year, month, day }, time: { hours: 23, minutes: 59, seconds: 59 } }
    : { date: { year, month, day }, time: { hours: 0 } }
}

// ── Paginated API fetch helpers ──

// GET list endpoint — dataType in URL is kebab-case; filter param uses snake_case
export async function fetchHealthData(dataType, startDate, endDate) {
  const snakeType = dataType.replace(/-/g, '_')
  const filter    = `${snakeType}.interval.civil_start_time >= "${startDate}T00:00:00" AND ${snakeType}.interval.civil_start_time <= "${endDate}T23:59:59"`
  const baseUrl   = `${HEALTH_BASE}/dataTypes/${dataType}/dataPoints`
  const all       = []
  let pageToken   = null

  do {
    const params = new URLSearchParams({ filter })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await healthRequest('GET', `${baseUrl}?${params}`)
    if (!data) return []
    all.push(...(data.dataPoints ?? []))
    pageToken = data.nextPageToken ?? null
  } while (pageToken)

  return all
}

// POST dailyRollUp — returns one bucket per day over the date range
async function fetchDailyRollUp(dataType, startDate, endDate) {
  const baseUrl   = `${HEALTH_BASE}/dataTypes/${dataType}/dataPoints:dailyRollUp`
  const all       = []
  let pageToken   = null

  do {
    const body = {
      range: { start: dateToRangeObj(startDate), end: dateToRangeObj(endDate, true) },
      windowSizeDays: 1,
      ...(pageToken ? { pageToken } : {}),
    }
    const data = await healthRequest('POST', baseUrl, body)
    if (!data) return []
    all.push(...(data.rollupDataPoint ?? []))
    pageToken = data.nextPageToken ?? null
  } while (pageToken)

  return all
}

// GET sleep reconcile — returns consolidated sleep sessions from wearables
async function fetchSleepReconcile() {
  const all     = []
  let pageToken = null

  do {
    const params = new URLSearchParams({ dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await healthRequest('GET', `${HEALTH_BASE}/dataTypes/sleep/dataPoints:reconcile?${params}`)
    if (!data) return []
    all.push(...(data.dataPoints ?? []))
    pageToken = data.nextPageToken ?? null
  } while (pageToken)

  return all
}

// ── Data parsers ──

function parseStepsRollup(rollupPoints) {
  const byDate = {}
  for (const pt of rollupPoints) {
    const date = parseCivilDate(pt.steps?.interval?.civilStartTime)
    if (!date) continue
    byDate[date] = parseInt(pt.steps?.countSum ?? '0', 10)
  }
  return byDate
}

function parseHeartRate(dataPoints) {
  const bpmsByDate = {}
  for (const pt of dataPoints) {
    const date = parseCivilDate(pt.heartRate?.interval?.civilStartTime)
    const bpm  = pt.heartRate?.beatsPerMinute
    if (!date || bpm == null) continue
    if (!bpmsByDate[date]) bpmsByDate[date] = []
    bpmsByDate[date].push(bpm)
  }
  const byDate = {}
  for (const [date, bpms] of Object.entries(bpmsByDate)) {
    byDate[date] = {
      resting_hr: Math.min(...bpms),
      avg_hr:     Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
    }
  }
  return byDate
}

function parseSleep(dataPoints) {
  const byDate = {}
  for (const pt of dataPoints) {
    const endTime = pt.sleep?.interval?.endTime
    if (!endTime) continue
    const date = endTime.slice(0, 10)

    const minutesAsleep = parseInt(pt.sleep?.summary?.minutesAsleep ?? '0', 10)
    const minutesAwake  = parseInt(pt.sleep?.summary?.minutesAwake  ?? '0', 10)

    const stageTotals = { DEEP: 0, REM: 0, LIGHT: 0, AWAKE: 0 }
    for (const stage of (pt.sleep?.stages ?? [])) {
      if (stage.type in stageTotals)
        stageTotals[stage.type] += parseInt(stage.minutes ?? '0', 10)
    }

    const deepMin  = stageTotals.DEEP
    const remMin   = stageTotals.REM
    const lightMin = stageTotals.LIGHT
    const awakeMin = stageTotals.AWAKE || minutesAwake

    // Keep longest sleep session per date
    if (!byDate[date] || minutesAsleep > (byDate[date].totalMinutes ?? 0)) {
      const total      = deepMin + remMin + lightMin + awakeMin
      const sleepScore = total > 0
        ? Math.round(((deepMin + remMin + lightMin) / total) * 100)
        : null

      byDate[date] = {
        totalMinutes: minutesAsleep,
        sleep_score:  sleepScore,
        sleep_stages: {
          deep:      deepMin,
          rem:       remMin,
          light:     lightMin,
          wake:      awakeMin,
          startTime: pt.sleep.interval.startTime,
          endTime:   pt.sleep.interval.endTime,
        },
      }
    }
  }
  return byDate
}

function parseHRV(dataPoints) {
  const byDate = {}
  for (const pt of dataPoints) {
    const date  = parseCivilDate(pt.dailyHeartRateVariability?.interval?.civilStartTime)
    const rmssd = pt.dailyHeartRateVariability?.dailyRmssd
    if (!date || rmssd == null) continue
    byDate[date] = rmssd
  }
  return byDate
}

function parseCalories(rollupPoints) {
  const byDate = {}
  for (const pt of rollupPoints) {
    const date = parseCivilDate(pt.activeEnergyBurned?.interval?.civilStartTime)
    const kcal = pt.activeEnergyBurned?.kilocaloriesSum
    if (!date || kcal == null) continue
    byDate[date] = Math.round(kcal)
  }
  return byDate
}

// ── Main sync function ──

export async function syncGfitData() {
  if (!isGfitConnected()) return null
  emitStatus('syncing')
  localStorage.removeItem('health_sync_error')

  try {
    const today     = new Date()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - 29)
    const startStr = startDate.toISOString().slice(0, 10)
    const endStr   = today.toISOString().slice(0, 10)

    const [stepsRollup, hrPoints, sleepPoints, hrvPoints, calRollup] = await Promise.all([
      fetchDailyRollUp('steps', startStr, endStr),
      fetchHealthData('heart-rate', startStr, endStr),
      fetchSleepReconcile(),
      fetchHealthData('daily-heart-rate-variability', startStr, endStr),
      fetchDailyRollUp('active-energy-burned', startStr, endStr),
    ])

    const stepsByDate    = parseStepsRollup(stepsRollup)
    const hrByDate       = parseHeartRate(hrPoints)
    const sleepByDate    = parseSleep(sleepPoints)
    const hrvByDate      = parseHRV(hrvPoints)
    const caloriesByDate = parseCalories(calRollup)

    const dates = new Set([
      ...Object.keys(stepsByDate),
      ...Object.keys(hrByDate),
      ...Object.keys(sleepByDate),
      ...Object.keys(hrvByDate),
      ...Object.keys(caloriesByDate),
    ])

    const rows = []
    for (const date of dates) {
      const sleep = sleepByDate[date]
      rows.push({
        user_id:        USER_ID,
        date,
        sleep_score:    sleep?.sleep_score              ?? null,
        sleep_stages:   sleep?.sleep_stages             ?? null,
        hrv:            hrvByDate[date]                  ?? null,
        resting_hr:     hrByDate[date]?.resting_hr       ?? null,
        steps:          stepsByDate[date]                ?? null,
        active_minutes: caloriesByDate[date]             ?? null,
        raw_fitbit_data: null,
      })
    }

    if (rows.length) {
      const { error } = await supabase
        .from('health_metrics')
        .upsert(rows, { onConflict: 'user_id,date' })
      if (error) {
        console.error('[Health] Supabase write failed:', error)
        localStorage.setItem('health_sync_error', error.message)
        emitStatus('error')
        return null
      }
    }

    const now = new Date().toISOString()
    setGfitLastSync(now)
    emitStatus('synced', now)
    return rows
  } catch (e) {
    console.error('[Health] Sync error:', e)
    localStorage.setItem('health_sync_error', e.message ?? String(e))
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

  if (error) { console.error('[Health] History fetch error:', error); return [] }
  return data ?? []
}

function emitStatus(status, lastSync = null) {
  window.dispatchEvent(new CustomEvent('gfit-sync-status', { detail: { status, lastSync } }))
}
