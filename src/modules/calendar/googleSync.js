import {
  getClientId, getAccessToken, getRefreshToken, getTokenExpiry,
  setTokens, clearTokens, isConnected,
} from '../../lib/api/gcalendar.js'
import { storeGet, storeSet } from '../../lib/storage.js'

const CAL_EVENTS_KEY = 'calendar_events'
const GCAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const HEX_TO_COLORID = {
  '#E03131': '11', '#E8590C': '6', '#F59F00': '5',
  '#2F9E44': '10', '#1971C2': '9', '#7048E8': '3', '#868E96': '8',
}

function toGoogleEvent(ev) {
  return {
    summary: ev.title,
    description: ev.description || '',
    start: { dateTime: new Date(ev.start_time).toISOString() },
    end:   { dateTime: new Date(ev.end_time).toISOString() },
    ...(ev.color ? { colorId: HEX_TO_COLORID[ev.color] || '8' } : {}),
  }
}

async function refreshTokenNow() {
  const refreshToken = getRefreshToken()
  const clientId = getClientId()
  if (!refreshToken || !clientId) {
    clearTokens()
    window.dispatchEvent(new Event('gcal-disconnected'))
    return null
  }
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    })
    if (!resp.ok) throw new Error('refresh failed')
    const data = await resp.json()
    setTokens({ access_token: data.access_token, expires_in: data.expires_in })
    return data.access_token
  } catch {
    clearTokens()
    window.dispatchEvent(new Event('gcal-disconnected'))
    return null
  }
}

async function getValidToken() {
  if (Date.now() < getTokenExpiry() - 2 * 60 * 1000) return getAccessToken()
  return refreshTokenNow()
}

async function gcalRequest(url, options = {}) {
  let token = await getValidToken()
  if (!token) return null

  const makeHeaders = (t) => ({
    Authorization: `Bearer ${t}`,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  })

  let resp = await fetch(url, { ...options, headers: makeHeaders(token) })

  if (resp.status === 401) {
    token = await refreshTokenNow()
    if (!token) return null
    resp = await fetch(url, { ...options, headers: makeHeaders(token) })
  }

  if (resp.status === 429) {
    await new Promise(r => setTimeout(r, 1500))
    resp = await fetch(url, { ...options, headers: makeHeaders(token) })
  }

  return resp
}

function emitStatus(status) {
  window.dispatchEvent(new CustomEvent('gcal-sync-status', { detail: { status } }))
}

export async function syncEventCreate(event) {
  if (!isConnected()) return
  const stored = (storeGet(CAL_EVENTS_KEY) || []).find(e => e.id === event.id)
  if (stored?.googleEventId) return
  emitStatus('syncing')
  try {
    const resp = await gcalRequest(GCAL_BASE, {
      method: 'POST',
      body: JSON.stringify(toGoogleEvent(event)),
    })
    if (!resp || !resp.ok) { emitStatus('error'); return }
    const data = await resp.json()
    const events = storeGet(CAL_EVENTS_KEY) || []
    storeSet(CAL_EVENTS_KEY, events.map(e => e.id === event.id ? { ...e, googleEventId: data.id } : e))
    window.dispatchEvent(new Event('calendar-gcal-synced'))
    emitStatus('synced')
  } catch {
    emitStatus('error')
  }
}

export async function syncEventUpdate(event) {
  if (!isConnected()) return
  const stored = (storeGet(CAL_EVENTS_KEY) || []).find(e => e.id === event.id)
  const gid = (stored || event).googleEventId
  if (!gid) { syncEventCreate(event); return }
  emitStatus('syncing')
  try {
    const resp = await gcalRequest(`${GCAL_BASE}/${gid}`, {
      method: 'PATCH',
      body: JSON.stringify(toGoogleEvent(event)),
    })
    emitStatus(resp && resp.ok ? 'synced' : 'error')
  } catch {
    emitStatus('error')
  }
}

export async function syncEventDelete(eventId) {
  if (!isConnected()) return
  const ev = (storeGet(CAL_EVENTS_KEY) || []).find(e => e.id === eventId)
  if (!ev?.googleEventId) return
  emitStatus('syncing')
  try {
    const resp = await gcalRequest(`${GCAL_BASE}/${ev.googleEventId}`, { method: 'DELETE' })
    emitStatus(resp && (resp.ok || resp.status === 404) ? 'synced' : 'error')
  } catch {
    emitStatus('error')
  }
}

export async function syncOnLoad() {
  if (!isConnected()) return
  const unsynced = (storeGet(CAL_EVENTS_KEY) || []).filter(e => !e.is_gym_planned && !e.googleEventId)
  for (const ev of unsynced) {
    await syncEventCreate(ev)
  }
}

// ── PKCE OAuth ──

function generateCodeVerifier() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateCodeChallenge(verifier) {
  const enc = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function initiateGoogleOAuth() {
  const clientId = getClientId()
  if (!clientId) { console.error('[GCal] No client ID stored'); return }
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  // Use localStorage — Safari clears sessionStorage across cross-origin redirects
  localStorage.setItem('gcal_code_verifier', verifier)
  const redirectUri = window.location.origin
  console.log('[GCal] Starting OAuth, redirect_uri:', redirectUri)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar openid email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (!code) {
    if (error) console.error('[GCal] OAuth error from Google:', error)
    return false
  }

  const verifier = localStorage.getItem('gcal_code_verifier')
  localStorage.removeItem('gcal_code_verifier')
  if (!verifier) {
    console.error('[GCal] No code_verifier found — Safari may have cleared storage')
    window.history.replaceState({}, '', '/')
    return false
  }

  const clientId = getClientId()
  const redirectUri = window.location.origin
  console.log('[GCal] Exchanging code for tokens, redirect_uri:', redirectUri)

  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}))
      console.error('[GCal] Token exchange failed:', resp.status, errData)
      window.history.replaceState({}, '', '/')
      return false
    }
    const data = await resp.json()
    console.log('[GCal] Token exchange succeeded, has refresh_token:', !!data.refresh_token)

    let email = null
    try {
      const uResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      })
      if (uResp.ok) email = (await uResp.json()).email
    } catch {}

    setTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      email,
    })
    console.log('[GCal] Connected as:', email)
    return true
  } catch (e) {
    console.error('[GCal] Token exchange threw:', e)
    window.history.replaceState({}, '', '/')
    return false
  }
}
