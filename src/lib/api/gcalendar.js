export const getClientId    = () => localStorage.getItem('gcal_client_id') || ''
export const setClientId    = (id) => {
  if (id.trim()) localStorage.setItem('gcal_client_id', id.trim())
  else localStorage.removeItem('gcal_client_id')
}

export const getAccessToken  = () => localStorage.getItem('gcal_access_token') || null
export const getRefreshToken = () => localStorage.getItem('gcal_refresh_token') || null
export const getTokenExpiry  = () => { const v = localStorage.getItem('gcal_token_expiry'); return v ? parseInt(v, 10) : 0 }
export const getUserEmail    = () => localStorage.getItem('gcal_user_email') || null

export const setTokens = ({ access_token, refresh_token, expires_in, email } = {}) => {
  if (access_token) localStorage.setItem('gcal_access_token', access_token)
  if (refresh_token) localStorage.setItem('gcal_refresh_token', refresh_token)
  if (expires_in)   localStorage.setItem('gcal_token_expiry', String(Date.now() + expires_in * 1000))
  if (email)        localStorage.setItem('gcal_user_email', email)
}

export const clearTokens = () => {
  ;['gcal_access_token', 'gcal_refresh_token', 'gcal_token_expiry', 'gcal_user_email'].forEach(k =>
    localStorage.removeItem(k)
  )
}

export const isConnected = () => !!getAccessToken()
