export const getNotionKey = () => localStorage.getItem('notion_api_key') || ''
export const setNotionKey = (key) => {
  if (key.trim()) localStorage.setItem('notion_api_key', key.trim())
  else localStorage.removeItem('notion_api_key')
}
