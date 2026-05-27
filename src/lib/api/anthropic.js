export const getAnthropicKey = () => localStorage.getItem('anthropic_api_key') || ''
export const setAnthropicKey = (key) => {
  if (key.trim()) localStorage.setItem('anthropic_api_key', key.trim())
  else localStorage.removeItem('anthropic_api_key')
}
