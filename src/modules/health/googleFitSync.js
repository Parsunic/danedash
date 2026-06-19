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

  if (resp.status === 403) {
    console.error('[Health] 403 Forbidden — OAuth scope missing or Health API not enabled in Cloud Console.')
    localStorage.setItem('health_sync_error', 'Access denied (403): Google Health permissions are missing. Please disconnect and reconnect Google Health in Settings to grant the required scopes.')
    return null
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => null)
    const errMsg  = errBody?.error?.message ?? JSON.stringify(errBody)
    console.error(`[Health] ${method} ${url} → ${resp.status}: ${errMsg}`)
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

// For daily aggregate types (resting HR, HRV) the API puts date directly on the type object
function parseDirectDate(d) {
  if (!d?.year || !d?.month || !d?.day) return null
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

// Civil (local) date for an ISO instant given its UTC offset string (e.g. "-14400s")
function localDateFromIso(iso, offsetStr) {
  if (!iso) return null
  const offsetSec = parseInt(offsetStr ?? '0', 10) || 0   // "-14400s" → -14400
  const local = new Date(new Date(iso).getTime() + offsetSec * 1000)
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`
}

function dateToRangeObj(dateStr, isEnd = false) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return isEnd
    ? { date: { year, month, day }, time: { hours: 23, minutes: 59, seconds: 59 } }
    : { date: { year, month, day }, time: { hours: 0 } }
}

// ── Paginated API fetch helpers ──

// GET dataPoints without any filter — for daily metrics + steps (the filtered list endpoint
// rejects our filter grammar, but the unfiltered endpoint is confirmed working)
const MAX_PAGES = 25

async function fetchDataPoints(dataType) {
  const baseUrl = `${HEALTH_BASE}/dataTypes/${dataType}/dataPoints`
  const all     = []
  let pageToken = null
  let pages     = 0

  do {
    const url  = pageToken ? `${baseUrl}?pageToken=${encodeURIComponent(pageToken)}` : baseUrl
    const data = await healthRequest('GET', url)
    if (!data) return all
    all.push(...(data.dataPoints ?? []))
    pageToken = data.nextPageToken ?? null
  } while (pageToken && ++pages < MAX_PAGES)

  return all
}

// GET list endpoint — dataType in URL is kebab-case; filter param uses snake_case
export async function fetchHealthData(dataType, startDate, endDate) {
  const camelType = dataType.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const filter    = `${camelType}.interval.civilStartTime >= "${startDate}T00:00:00" AND ${camelType}.interval.civilStartTime <= "${endDate}T23:59:59"`
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
    all.push(...(data.rollupDataPoint ?? data.dataPoints ?? []))
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

function parseSteps(points) {
  const byDate = {}
  for (const pt of points) {
    const typeData = pt.steps
    if (!typeData) continue
    // each point is an interval with a string count; bucket by its civil start date
    const date  = parseCivilDate(typeData.interval?.civilStartTime)
              ?? localDateFromIso(typeData.interval?.startTime, typeData.interval?.startUtcOffset)
    const count = parseInt(typeData.countSum ?? typeData.count ?? '0', 10)
    if (!date) {
      console.log('[Health][diagnostic] steps point missing date:', JSON.stringify(pt))
      continue
    }
    if (isNaN(count) || count === 0) continue   // zero-step intervals are normal, skip silently
    byDate[date] = (byDate[date] ?? 0) + count
  }
  return byDate
}

function parseRestingHR(dataPoints) {
  const byDate = {}
  for (const pt of dataPoints) {
    const typeData = pt.dailyRestingHeartRate
    // daily aggregate types have date directly on the type object, not inside an interval
    const date = parseDirectDate(typeData?.date)
             ?? parseCivilDate(typeData?.interval?.civilStartTime ?? pt.interval?.civilStartTime)
    const bpm  = typeData?.beatsPerMinute
    if (!date || bpm == null) {
      console.log('[Health][diagnostic] restingHR unexpected shape:', JSON.stringify(pt))
      continue
    }
    byDate[date] = { resting_hr: Math.round(Number(bpm)) }
  }
  return byDate
}

function parseHRV(dataPoints) {
  const byDate = {}
  for (const pt of dataPoints) {
    const typeData = pt.dailyHeartRateVariability
    // daily aggregate types have date directly on the type object, not inside an interval
    const date  = parseDirectDate(typeData?.date)
              ?? parseCivilDate(typeData?.interval?.civilStartTime ?? pt.interval?.civilStartTime)
    // actual field name is averageHeartRateVariabilityMilliseconds
    const rmssd = typeData?.averageHeartRateVariabilityMilliseconds ?? typeData?.dailyRmssd
    if (!date || rmssd == null) {
      console.log('[Health][diagnostic] hrv unexpected shape:', JSON.stringify(pt))
      continue
    }
    byDate[date] = Number(rmssd)
  }
  return byDate
}

function parseSleep(dataPoints) {
  const byDate = {}
  for (const pt of dataPoints) {
    const sleepData = pt.sleep
    if (!sleepData) {
      console.log('[Health][diagnostic] sleep point missing "sleep" key:', JSON.stringify(pt))
      continue
    }
    const endTime = sleepData.interval?.endTime
    if (!endTime) {
      console.log('[Health][diagnostic] sleep point missing interval.endTime:', JSON.stringify(pt))
      continue
    }
    const date = endTime.slice(0, 10)

    const minutesAsleep = parseInt(sleepData.summary?.minutesAsleep ?? '0', 10)
    const minutesAwake  = parseInt(sleepData.summary?.minutesAwake  ?? '0', 10)

    const stageTotals = { DEEP: 0, REM: 0, LIGHT: 0, AWAKE: 0 }
    for (const stage of (sleepData.stages ?? [])) {
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
          startTime: sleepData.interval.startTime,
          endTime:   sleepData.interval.endTime,
        },
      }
    }
  }
  return byDate
}

function parseCalories(rollupPoints) {
  const byDate = {}
  for (const pt of rollupPoints) {
    const typeData = pt.activeEnergyBurned
    const date = parseCivilDate(pt.interval?.civilStartTime ?? typeData?.interval?.civilStartTime)
    const kcal = typeData?.kilocaloriesSum ?? typeData?.kilocalories
    if (!date || kcal == null) continue
    byDate[date] = (byDate[date] ?? 0) + Math.round(Number(kcal))
  }
  return byDate
}

// ── Main sync function ──

export async function syncGfitData() {
  if (!isGfitConnected()) return null
  emitStatus('syncing')
  localStorage.removeItem('health_sync_error')

  try {
    // ── Identity diagnostic ──
    const identity = await healthRequest('GET', `${HEALTH_BASE}/identity`)
    if (identity?.healthUserId) {
      console.log(`[Health][diagnostic] identity OK — healthUserId: ${identity.healthUserId}, legacyUserId: ${identity.legacyUserId ?? 'none'}`)
    } else {
      console.warn(`[Health][diagnostic] identity call returned no healthUserId:`, JSON.stringify(identity))
    }

    // Use local date to avoid UTC date-shift at day boundaries
    const nowDate = new Date()
    const lp  = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const endStr   = lp(nowDate)
    const startObj = new Date(nowDate); startObj.setDate(startObj.getDate() - 29)
    const startStr = lp(startObj)

    const [stepsPoints, restingHrPoints, sleepPoints, hrvPoints, calRollup] = await Promise.all([
      fetchDataPoints('steps'),   // unfiltered endpoint (filter grammar 400s); aggregate by civil date
      fetchDataPoints('daily-resting-heart-rate'),
      fetchSleepReconcile(),
      fetchDataPoints('daily-heart-rate-variability'),
      fetchDailyRollUp('active-energy-burned', startStr, endStr),
    ])

    // Diagnostic logging BEFORE parsing so raw shapes are visible in the console
    if (stepsPoints.length > 0)        console.log('[Health][diagnostic] stepsPoints[0]:', JSON.stringify(stepsPoints[0]))
    else                               console.log('[Health][diagnostic] stepsPoints: empty')
    if (restingHrPoints.length > 0)    console.log('[Health][diagnostic] restingHR[0]:', JSON.stringify(restingHrPoints[0]))
    else                               console.log('[Health][diagnostic] restingHR: empty')
    if (hrvPoints.length > 0)          console.log('[Health][diagnostic] hrv[0]:', JSON.stringify(hrvPoints[0]))
    else                               console.log('[Health][diagnostic] hrv: empty')
    if (sleepPoints.length > 0)        console.log('[Health][diagnostic] sleep[0]:', JSON.stringify(sleepPoints[0]))
    else                               console.log('[Health][diagnostic] sleep: empty')
    if (calRollup.length > 0)          console.log('[Health][diagnostic] calRollup[0]:', JSON.stringify(calRollup[0]))
    else                               console.log('[Health][diagnostic] calRollup: empty')

    const stepsByDate    = parseStepsRollup(stepsPoints)
    const hrByDate       = parseRestingHR(restingHrPoints)
    const sleepByDate    = parseSleep(sleepPoints)
    const hrvByDate      = parseHRV(hrvPoints)
    const caloriesByDate = parseCalories(calRollup)

    console.log(`[Health][diagnostic] parsed — steps:${Object.keys(stepsByDate).length} restingHR:${Object.keys(hrByDate).length} sleep:${Object.keys(sleepByDate).length} hrv:${Object.keys(hrvByDate).length} calories:${Object.keys(caloriesByDate).length} days`)

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

    const scopeErr = localStorage.getItem('health_sync_error')
    if (scopeErr) {
      emitStatus('error')
      return rows.length ? rows : null
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
  const oldestStr = `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2, '0')}-${String(oldest.getDate()).padStart(2, '0')}`

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
