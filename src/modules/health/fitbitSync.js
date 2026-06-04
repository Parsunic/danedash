import { supabase } from '../../lib/supabase.js'
import {
  getFitbitClientId,
  getFitbitAccessToken, getFitbitRefreshToken, getFitbitTokenExpiry,
  setFitbitTokens, clearFitbitTokens, isFitbitConnected,
  getFitbitLastSync, setFitbitLastSync,
} from '../../lib/api/fitbit.js'

const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token'
const FITBIT_BASE      = 'https://api.fitbit.com'
const USER_ID          = 'dane'
const SYNC_INTERVAL_MS = 60 * 60 * 1000 // re-sync once per hour on tab open

// ── PKCE helpers (mirrors googleSync.js pattern) ──

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

export async function initiateFitbitOAuth() {
  const clientId = getFitbitClientId()
  if (!clientId) { console.error('[Fitbit] No client ID set'); return }

  const verifier  = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state     = crypto.randomUUID()

  // Use localStorage — Safari clears sessionStorage across cross-origin redirects
  localStorage.setItem('fitbit_code_verifier', verifier)
  localStorage.setItem('fitbit_oauth_state', state)

  const redirectUri = window.location.origin
  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          redirectUri,
    response_type:         'code',
    scope:                 'sleep heartrate activity',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
  })
  window.location.href = `https://www.fitbit.com/oauth2/authorize?${params}`
}

export async function handleFitbitCallback() {
  const params      = new URLSearchParams(window.location.search)
  const code        = params.get('code')
  const returnState = params.get('state')
  const error       = params.get('error')

  if (!code) {
    if (error) console.error('[Fitbit] OAuth error:', error)
    return false
  }

  const storedState = localStorage.getItem('fitbit_oauth_state')
  const verifier    = localStorage.getItem('fitbit_code_verifier')
  localStorage.removeItem('fitbit_oauth_state')
  localStorage.removeItem('fitbit_code_verifier')

  if (!verifier || storedState !== returnState) {
    console.error('[Fitbit] State mismatch or missing verifier')
    window.history.replaceState({}, '', '/')
    return false
  }

  const clientId    = getFitbitClientId()
  const redirectUri = window.location.origin

  try {
    // Fitbit PKCE public client: Basic auth uses base64(clientId:) with empty secret
    const basicAuth = btoa(`${clientId}:`)
    const resp = await fetch(FITBIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
        client_id:     clientId,
      }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      console.error('[Fitbit] Token exchange failed:', resp.status, err)
      window.history.replaceState({}, '', '/')
      return false
    }

    const data = await resp.json()
    setFitbitTokens({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
    })
    persistTokensToSupabase(data.access_token, data.refresh_token, data.expires_in)

    console.log('[Fitbit] Connected, scopes:', data.scope)
    window.dispatchEvent(new Event('fitbit-connected'))
    return true
  } catch (e) {
    console.error('[Fitbit] Token exchange threw:', e)
    window.history.replaceState({}, '', '/')
    return false
  }
}

// ── Token management ──

async function refreshFitbitToken() {
  const refreshToken = getFitbitRefreshToken()
  const clientId     = getFitbitClientId()
  if (!refreshToken || !clientId) {
    clearFitbitTokens()
    window.dispatchEvent(new Event('fitbit-disconnected'))
    return null
  }

  try {
    const basicAuth = btoa(`${clientId}:`)
    const resp = await fetch(FITBIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     clientId,
      }),
    })

    if (!resp.ok) throw new Error(`refresh ${resp.status}`)
    const data = await resp.json()
    setFitbitTokens({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
    })
    persistTokensToSupabase(data.access_token, data.refresh_token, data.expires_in)
    return data.access_token
  } catch {
    clearFitbitTokens()
    window.dispatchEvent(new Event('fitbit-disconnected'))
    return null
  }
}

async function getValidFitbitToken() {
  if (Date.now() < getFitbitTokenExpiry() - 2 * 60 * 1000) return getFitbitAccessToken()
  return refreshFitbitToken()
}

async function fitbitRequest(path) {
  let token = await getValidFitbitToken()
  if (!token) return null

  let resp = await fetch(`${FITBIT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (resp.status === 401) {
    token = await refreshFitbitToken()
    if (!token) return null
    resp = await fetch(`${FITBIT_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  if (!resp.ok) { console.error('[Fitbit] API error:', resp.status, path); return null }
  return resp.json()
}

// ── Supabase persistence ──

function persistTokensToSupabase(accessToken, refreshToken, expiresIn) {
  supabase.from('user_integrations').upsert({
    user_id:       USER_ID,
    provider:      'fitbit',
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_at:    new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes:        'sleep heartrate activity',
  }, { onConflict: 'user_id,provider' }).then(({ error }) => {
    if (error) console.warn('[Fitbit] Could not persist tokens to Supabase:', error.message)
  })
}

// Load tokens from Supabase on init if localStorage is empty (cross-device sync)
export async function loadTokensFromSupabase() {
  if (isFitbitConnected()) return
  try {
    const { data } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', USER_ID)
      .eq('provider', 'fitbit')
      .single()

    if (data?.access_token) {
      const expiresIn = Math.max(0, (new Date(data.expires_at).getTime() - Date.now()) / 1000)
      setFitbitTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: expiresIn })
      window.dispatchEvent(new Event('fitbit-connected'))
    }
  } catch {}
}

// ── Data sync ──

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export async function syncFitbitData(date = todayStr()) {
  if (!isFitbitConnected()) return null
  emitStatus('syncing')

  try {
    const [sleepData, hrvData, hrData, stepsData, fairlyData, veryData] = await Promise.all([
      fitbitRequest(`/1.2/user/-/sleep/date/${date}.json`),
      fitbitRequest(`/1/user/-/hrv/date/${date}.json`),
      fitbitRequest(`/1/user/-/activities/heart/date/${date}/1d.json`),
      fitbitRequest(`/1/user/-/activities/steps/date/${date}/1d.json`),
      fitbitRequest(`/1/user/-/activities/minutesFairlyActive/date/${date}/1d.json`),
      fitbitRequest(`/1/user/-/activities/minutesVeryActive/date/${date}/1d.json`),
    ])

    // Parse sleep — prefer isMainSleep entry
    const mainSleep   = sleepData?.sleep?.find(s => s.isMainSleep) ?? sleepData?.sleep?.[0] ?? null
    const sleepScore  = mainSleep?.efficiency ?? null
    const sleepStages = mainSleep ? {
      deep:      mainSleep.levels?.summary?.deep?.minutes  ?? 0,
      light:     mainSleep.levels?.summary?.light?.minutes ?? 0,
      rem:       mainSleep.levels?.summary?.rem?.minutes   ?? 0,
      wake:      mainSleep.levels?.summary?.wake?.minutes  ?? 0,
      startTime: mainSleep.startTime  ?? null,
      endTime:   mainSleep.endTime    ?? null,
    } : null

    const hrv       = hrvData?.hrv?.[0]?.value?.dailyRmssd ?? null
    const restingHr = hrData?.['activities-heart']?.[0]?.value?.restingHeartRate ?? null

    const stepsRaw = stepsData?.['activities-steps']?.[0]?.value
    const steps    = stepsRaw != null ? parseInt(stepsRaw, 10) : null

    const fairly    = parseInt(fairlyData?.['activities-minutesFairlyActive']?.[0]?.value ?? '0', 10)
    const very      = parseInt(veryData?.['activities-minutesVeryActive']?.[0]?.value     ?? '0', 10)
    const activeMin = fairly + very > 0 ? fairly + very : null

    const { error } = await supabase
      .from('health_metrics')
      .upsert({
        user_id:         USER_ID,
        date,
        sleep_score:     sleepScore,
        sleep_stages:    sleepStages,
        hrv,
        resting_hr:      restingHr,
        steps,
        active_minutes:  activeMin,
        raw_fitbit_data: { sleepData, hrvData, hrData, stepsData, fairlyData, veryData },
      }, { onConflict: 'user_id,date' })

    if (error) { console.error('[Fitbit] Supabase write failed:', error); emitStatus('error'); return null }

    const now = new Date().toISOString()
    setFitbitLastSync(now)
    emitStatus('synced', now)
    return { date, sleep_score: sleepScore, sleep_stages: sleepStages, hrv, resting_hr: restingHr, steps, active_minutes: activeMin }
  } catch (e) {
    console.error('[Fitbit] Sync error:', e)
    emitStatus('error')
    return null
  }
}

export async function syncTodayIfStale() {
  if (!isFitbitConnected()) return
  const last = getFitbitLastSync()
  if (last && Date.now() - new Date(last).getTime() < SYNC_INTERVAL_MS) return
  return syncFitbitData()
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

  if (error) { console.error('[Fitbit] History fetch error:', error); return [] }
  return data ?? []
}

function emitStatus(status, lastSync = null) {
  window.dispatchEvent(new CustomEvent('fitbit-sync-status', { detail: { status, lastSync } }))
}
