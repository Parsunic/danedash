import { useState, useEffect, useRef, useCallback } from 'react'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import {
  selectModel, maxTokensForModel,
  fetchStaticPrompt, buildDynamicContext,
  callOverseer, generateContextPackage, saveMessage,
  STATIC_PROMPT_FALLBACK,
} from '../../lib/overseer.js'

const MODEL_LABEL = { 'claude-haiku-4-5-20251001': 'haiku', 'claude-sonnet-4-6': 'sonnet' }

function ModelBadge({ model }) {
  const label = MODEL_LABEL[model] || model.split('-')[1] || model
  return <span className="overseer-model-badge">{label}</span>
}

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`overseer-msg overseer-msg--${msg.role}`}>
      <div className="overseer-msg-bubble">
        {msg.content || <span className="overseer-cursor">▌</span>}
      </div>
      {!isUser && msg.model && <ModelBadge model={msg.model} />}
    </div>
  )
}

function ExportModal({ content, onClose }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [content])

  return (
    <div className="overseer-export-backdrop" onClick={onClose}>
      <div className="overseer-export-modal" onClick={e => e.stopPropagation()}>
        <div className="overseer-export-header">
          <span className="overseer-export-title">Context Package</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-primary" style={{ padding: '7px 14px', fontSize: '0.8rem' }} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button className="overseer-export-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <textarea
          className="overseer-export-textarea"
          readOnly
          value={content}
        />
        <p className="overseer-export-hint">Paste this into your Claude Project to give it full context.</p>
      </div>
    </div>
  )
}

export default function Overseer() {
  const [messages, setMessages]           = useState([])
  const [input, setInput]                 = useState('')
  const [isLoading, setIsLoading]         = useState(false)
  const [mode, setMode]                   = useState('standard')
  const [systemPrompt, setSystemPrompt]   = useState('')
  const [currentModel, setCurrentModel]   = useState('claude-haiku-4-5-20251001')
  const [exportContent, setExportContent] = useState(null)
  const [isExporting, setIsExporting]     = useState(false)
  const [error, setError]                 = useState(null)
  const sessionId                         = useRef(crypto.randomUUID())
  const messagesEndRef                    = useRef(null)
  const textareaRef                       = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // On mount: fetch static prompt from Supabase (or use fallback), then build initial context
  useEffect(() => {
    async function init() {
      const stored = await fetchStaticPrompt()
      const base = stored || STATIC_PROMPT_FALLBACK
      const dynCtx = await buildDynamicContext('standard')
      setSystemPrompt(base + dynCtx)
    }
    init()
  }, [])

  const getApiKey = useCallback(() => {
    const key = localStorage.getItem('anthropic_api_key') || ''
    if (!key) setError('API key not set — open Settings ⚙ and add your Anthropic key.')
    return key
  }, [])

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return
    const apiKey = getApiKey()
    if (!apiKey) return

    setError(null)
    const userText = input.trim()
    const model = selectModel(userText, mode)
    setCurrentModel(model)

    const userMsg = { role: 'user', content: userText }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '', model }])
    setInput('')
    setIsLoading(true)

    // Re-fetch dynamic context for each message in standard mode
    let activeSystemPrompt = systemPrompt
    if (mode === 'standard') {
      try {
        const stored = await fetchStaticPrompt()
        const base = stored || STATIC_PROMPT_FALLBACK
        const dynCtx = await buildDynamicContext('standard')
        activeSystemPrompt = base + dynCtx
        setSystemPrompt(activeSystemPrompt)
      } catch {}
    }

    try {
      const apiMessages = history.map(m => ({ role: m.role, content: m.content }))

      await callOverseer({
        apiKey,
        systemPrompt: activeSystemPrompt,
        messages: apiMessages,
        model,
        onChunk: (chunk) => {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + chunk,
            }
            return updated
          })
        },
        onDone: (fullText) => {
          saveMessage({ sessionId: sessionId.current, role: 'user', content: userText })
          saveMessage({ sessionId: sessionId.current, role: 'assistant', content: fullText, modelUsed: model })
        },
      })
    } catch (e) {
      console.error('[Overseer]', e)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: 'Something went wrong. Check your API key and connection.',
        }
        return updated
      })
    } finally {
      setIsLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [input, isLoading, mode, messages, systemPrompt, getApiKey])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleExport = useCallback(async () => {
    const apiKey = getApiKey()
    if (!apiKey || isExporting) return
    setIsExporting(true)
    setError(null)
    try {
      const dynCtx = await buildDynamicContext('standard')
      const pkg = await generateContextPackage(apiKey, dynCtx)
      setExportContent(pkg)
      try { await navigator.clipboard.writeText(pkg) } catch {}
    } catch (e) {
      setError('Export failed: ' + (e.message || 'unknown error'))
    } finally {
      setIsExporting(false)
    }
  }, [isExporting, getApiKey])

  const modelLabel = MODEL_LABEL[currentModel] || currentModel

  return (
    <div className="overseer-root">
      <BackgroundBlob page="overseer" />

      {/* Header */}
      <div className="overseer-header">
        <div className="overseer-header-left">
          <div className="overseer-eyebrow">OVERSEER</div>
          <div className="overseer-header-row">
            <h1 className="overseer-title">Your personal advisor</h1>
            <span className="overseer-live-model">{modelLabel}</span>
          </div>
        </div>

        <div className="overseer-header-right">
          {/* Mode toggle */}
          <div className="overseer-mode-toggle">
            <button
              className={mode === 'quick' ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '7px 14px', fontSize: '0.8rem' }}
              onClick={() => setMode('quick')}
            >
              ⚡ Quick
            </button>
            <button
              className={mode === 'standard' ? 'btn-primary' : 'btn-secondary'}
              style={{ padding: '7px 14px', fontSize: '0.8rem' }}
              onClick={() => setMode('standard')}
            >
              ● Standard
            </button>
          </div>

          <button
            className="btn-ghost"
            style={{ padding: '7px 14px', fontSize: '0.8rem' }}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Generating…' : 'Export context'}
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="overseer-error">{error}</div>
      )}

      {/* Messages */}
      <div className="overseer-messages">
        {messages.length === 0 && (
          <div className="overseer-empty">
            <div className="overseer-empty-title">Ready.</div>
            <div className="overseer-empty-hint">
              Ask anything. Get a decision, not a hedge.
              <br />
              <span style={{ opacity: 0.5 }}>"Should I retake the SAT?" · "What should I write my Common App essay about?" · "Prioritize my week."</span>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="overseer-input-area">
        <textarea
          ref={textareaRef}
          className="overseer-input"
          placeholder={mode === 'quick' ? 'Quick question…' : 'Ask Overseer…'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isLoading}
        />
        <button
          className="overseer-send-btn"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          aria-label="Send"
        >
          ↑
        </button>
      </div>

      {/* Export modal */}
      {exportContent && (
        <ExportModal content={exportContent} onClose={() => setExportContent(null)} />
      )}
    </div>
  )
}
