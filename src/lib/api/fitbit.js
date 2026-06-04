export const getFitbitClientId = () => localStorage.getItem('fitbit_client_id') || ''
export const setFitbitClientId = (id) => {
  if (id.trim()) localStorage.setItem('fitbit_client_id', id.trim())
  else localStorage.removeItem('fitbit_client_id')
}

export const getFitbitAccessToken  = () => localStorage.getItem('fitbit_access_token') || null
export const getFitbitRefreshToken = () => localStorage.getItem('fitbit_refresh_token') || null
export const getFitbitTokenExpiry  = () => {
  const v = localStorage.getItem('fitbit_token_expiry')
  return v ? parseInt(v, 10) : 0
}

export const getFitbitLastSync = () => localStorage.getItem('fitbit_last_sync') || null
export const setFitbitLastSync = (ts) => localStorage.setItem('fitbit_last_sync', ts)

export const setFitbitTokens = ({ access_token, refresh_token, expires_in } = {}) => {
  if (access_token) localStorage.setItem('fitbit_access_token', access_token)
  if (refresh_token) localStorage.setItem('fitbit_refresh_token', refresh_token)
  if (expires_in)   localStorage.setItem('fitbit_token_expiry', String(Date.now() + expires_in * 1000))
}

export const clearFitbitTokens = () => {
  ;['fitbit_access_token', 'fitbit_refresh_token', 'fitbit_token_expiry'].forEach(k =>
    localStorage.removeItem(k)
  )
}

export const isFitbitConnected = () => !!getFitbitAccessToken()
