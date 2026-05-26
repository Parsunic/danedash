// Client-side Anthropic calls must go through a server-side proxy to protect the API key.
export const ANTHROPIC_PROXY_URL = import.meta.env.VITE_ANTHROPIC_PROXY_URL ?? '/api/anthropic'
