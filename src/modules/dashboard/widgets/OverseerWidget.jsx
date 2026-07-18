import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { STATIC_PROMPT_FALLBACK } from '../../../lib/overseer.js'
import { renderMarkdown } from '../../../lib/renderMarkdown.jsx'

// Overseer chat widget — copied from Dashboard.jsx DashChatWidget. No logic
// changes. L: today's compact chat. XL: same tree — the messages area simply
// flex-grows into the taller/wider cell. One stable tree across sizes so the
// stream and input state survive resize/reorder.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DASH_MODEL = 'claude-haiku-4-5-20251001'

export default function OverseerWidget({ size, bp }) {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const endRef    = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return
    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No API key set — add one in Settings ⚙.' }])
      setInput('')
      return
    }

    const userMsg = { role: 'user', content: input.trim() }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: DASH_MODEL,
          max_tokens: 1024,
          stream: true,
          system: STATIC_PROMPT_FALLBACK,
          messages: history.slice(-8).map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) throw new Error(`${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const ev = JSON.parse(payload)
            if (ev.type === 'content_block_delta' && ev.delta?.text) {
              setMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + ev.delta.text }
                return next
              })
            }
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], content: 'Something went wrong. Try again.' }
        return next
      })
    } finally {
      setStreaming(false)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [input, streaming, messages])

  const onKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }, [send])

  return (
    <div className="dash-chat-widget" style={{ height: '100%', padding: 0, minHeight: 0 }}>
      <div className="dash-widget-header" style={{ marginBottom: 0 }}>
        <span className="dash-widget-label">Overseer</span>
        <Link to="/overseer" className="dash-widget-link">Full →</Link>
      </div>

      <div className="dash-chat-messages" style={{ flex: 1, maxHeight: 'none', minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="dash-chat-empty">Ask anything quick.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`dash-chat-msg dash-chat-msg--${m.role}`}>
            {m.content ? renderMarkdown(m.content) : <span className="dash-chat-cursor">▌</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="dash-chat-input-row">
        <input
          ref={inputRef}
          className="dash-chat-input"
          type="text"
          placeholder="Quick question…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={streaming}
        />
        <button
          className="dash-chat-send"
          onClick={send}
          disabled={streaming || !input.trim()}
          aria-label="Send"
        >↑</button>
      </div>
    </div>
  )
}
