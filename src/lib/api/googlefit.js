// Google Fit / Google Health Connect token storage.
// Reuses the same Google OAuth client credentials already configured
// for Google Calendar — no separate app registration needed.
import { getClientId, getClientSecret } from './gcalendar.js'
export { getClientId as getGfitClientId, getClientSecret as getGfitClientSecret }

export const getGfitAccessToken  = () => localStorage.getItem('gfit_access_token') || null
export const getGfitRefreshToken = () => localStorage.getItem('gfit_refresh_token') || null
export const getGfitTokenExpiry  = () => {
  const v = localStorage.getItem('gfit_token_expiry')
  return v ? parseInt(v, 10) : 0
}
export const getGfitLastSync = () => localStorage.getItem('gfit_last_sync') || null
export const setGfitLastSync = (ts) => localStorage.setItem('gfit_last_sync', ts)

export const setGfitTokens = ({ access_token, refresh_token, expires_in } = {}) => {
  if (access_token) localStorage.setItem('gfit_access_token', access_token)
  if (refresh_token) localStorage.setItem('gfit_refresh_token', refresh_token)
  if (expires_in)   localStorage.setItem('gfit_token_expiry', String(Date.now() + expires_in * 1000))
}

export const clearGfitTokens = () => {
  ;['gfit_access_token', 'gfit_refresh_token', 'gfit_token_expiry'].forEach(k =>
    localStorage.removeItem(k)
  )
}

export const isGfitConnected = () => !!getGfitAccessToken()
