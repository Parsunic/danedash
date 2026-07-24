import { useState, useEffect, useRef, useCallback } from 'react'
import {
  selectModel, maxTokensForModel, fetchStaticPrompt,
  callOverseer, generateContextPackage, saveMessage,
  STATIC_PROMPT_FALLBACK,
} from '../../lib/overseer.js'
import { loadOverseerConfig, saveOverseerConfig, sanitizeConfig } from './overseerConfig.js'
import { buildTerminalContext } from './terminalContext.js'
import { runCommand } from './terminalCommands.js'
import { OvtSprite } from './sprites.jsx'

// Overseer Phosphor Terminal — scanline CRT chat. All controls are slash
// commands (terminalCommands.js); config lives in synced overseer_config_v1
// (overseerConfig.js — no boot writes, storeSet on command gestures only).
// Chat plumbing (streaming, model auto-select, overseer_messages logging)
// reuses lib/overseer.js unchanged apart from the historyWindow param.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL_IDS = { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-4-6' }
const MODEL_LABEL = { 'claude-haiku-4-5-20251001': 'haiku', 'claude-sonnet-4-6': 'sonnet' }
const BAR_SLOTS = 12
const CHIPS = ['/help', '/context', '/recall', '/mode', '/clear']
const REDUCED = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ── Minimal mono-safe markdown (bold / code / em / bullets / headings) ──
function inlinePhos(text) {
  const parts = String(text).split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="ovt-code">{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

const VERDICT_RE = /^\s*(?:►|verdict\b)/i

function renderPhosphor(text, caret) {
  const lines = String(text).split('\n')
  return lines.map((line, i) => {
    const caretEl = caret && i === lines.length - 1 ? <span className="ovt-caret" /> : null
    if (VERDICT_RE.test(line)) {
      return <div key={i} className="ovt-verdict">{inlinePhos(line.replace(/^\s*►\s*/, '► '))}{caretEl}</div>
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) return <div key={i} className="ovt-h">{inlinePhos(h[2])}{caretEl}</div>
    const b = line.match(/^\s*[-*]\s+(.+)$/)
    if (b) return <div key={i} className="ovt-li"><span className="ovt-li-dot">·</span><span>{inlinePhos(b[1])}{caretEl}</span></div>
    if (!line.trim()) return caretEl ? <div key={i} className="ovt-line">{caretEl}</div> : <div key={i} className="ovt-gap" />
    return <div key={i} className="ovt-line">{inlinePhos(line)}{caretEl}</div>
  })
}

function PromptLine({ text }) {
  return (
    <div className="ovt-prompt">
      <span className="ovt-ps">dane@overseer</span>
      <span className="ovt-ps-dim">:~ $</span>{' '}
      <span className="ovt-cmd">{text}</span>
    </div>
  )
}

function ExportBlock({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [text])
  return (
    <div className="ovt-export">
      <div className="ovt-export-head">
        <span>context package · {text.length} chars</span>
        <button type="button" className="ovt-chip" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
      </div>
      <div className="ovt-export-body">{text}</div>
    </div>
  )
}

export default function OverseerTerminal() {
  const [items, setItems]             = useState([])
  const [input, setInput]             = useState('')
  const [streaming, setStreaming]     = useState(false)
  const [config, setConfig]           = useState(loadOverseerConfig)
  const [boot, setBoot]               = useState({ active: true, step: 0, bar: 0 })
  const [promptEdit, setPromptEdit]   = useState(null)
  const [verdictFlash, setVerdictFlash] = useState(false)
  const [ctxChars, setCtxChars]       = useState(null)
  const [lastModel, setLastModel]     = useState(null)

  const sessionIdRef   = useRef(crypto.randomUUID())
  const idRef          = useRef(0)
  const itemsRef       = useRef([])
  const configRef      = useRef(config)
  const bootTimersRef  = useRef([])
  const introRef       = useRef(false)
  const recallHitsRef  = useRef(null)
  const recalledRef    = useRef(null)
  const lastRequestRef = useRef(null)
  const flashedRef     = useRef(false)
  const verdictTimerRef = useRef(null)
  const screenRef      = useRef(null)
  const inputRef       = useRef(null)
  const editorRef      = useRef(null)

  useEffect(() => { configRef.current = config }, [config])

  // ── Transcript (state + synchronous ref mirror for the send path) ──
  const appendItems = useCallback((blocks) => {
    const stamped = blocks.map(b => ({ id: ++idRef.current, ...b }))
    itemsRef.current = [...itemsRef.current, ...stamped]
    setItems(itemsRef.current)
    return stamped
  }, [])

  const updateItem = useCallback((id, updater) => {
    itemsRef.current = itemsRef.current.map(it => (it.id === id ? updater(it) : it))
    setItems(itemsRef.current)
  }, [])

  useEffect(() => {
    const el = screenRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, boot])

  // ── Boot sequence (~1.2s, skippable; /clear reruns fast; reduced-motion instant) ──
  const clearBootTimers = useCallback(() => {
    bootTimersRef.current.forEach(clearTimeout)
    bootTimersRef.current = []
  }, [])

  const appendIntro = useCallback(() => {
    if (introRef.current) return
    introRef.current = true
    appendItems([{ kind: 'dim', text: '// overseer terminal — /help for commands, or just talk.' }])
  }, [appendItems])

  const finishBoot = useCallback(() => {
    clearBootTimers()
    setBoot({ active: false, step: 3, bar: BAR_SLOTS })
    appendIntro()
  }, [clearBootTimers, appendIntro])

  const runBoot = useCallback((fast) => {
    clearBootTimers()
    if (REDUCED) {
      setBoot({ active: false, step: 3, bar: BAR_SLOTS })
      appendIntro()
      return
    }
    setBoot({ active: true, step: 0, bar: 0 })
    const S = fast ? 0.4 : 1
    const at = (ms, fn) => bootTimersRef.current.push(setTimeout(fn, Math.round(ms * S)))
    at(140, () => setBoot(b => ({ ...b, step: Math.max(b.step, 1) })))
    for (let i = 1; i <= BAR_SLOTS; i++) {
      at(180 + i * 55, () => setBoot(b => ({ ...b, bar: Math.max(b.bar, i) })))
    }
    at(520, () => setBoot(b => ({ ...b, step: Math.max(b.step, 2) })))
    at(980, () => setBoot(b => ({ ...b, step: Math.max(b.step, 3) })))
    at(1260, () => { setBoot({ active: false, step: 3, bar: BAR_SLOTS }); appendIntro() })
  }, [clearBootTimers, appendIntro])

  // Attach the boot-skip listener on the NEXT task: when /clear starts a fresh
  // boot, the Enter keydown that submitted it is still bubbling toward window —
  // a synchronously-attached listener would catch that same event and skip the
  // boot it just started.
  useEffect(() => {
    if (!boot.active) return
    const onKey = () => finishBoot()
    const id = setTimeout(() => window.addEventListener('keydown', onKey), 0)
    return () => { clearTimeout(id); window.removeEventListener('keydown', onKey) }
  }, [boot.active, finishBoot])

  // ── System prompt + context size ──
  const getStaticPrompt = useCallback(async () => {
    const cfg = configRef.current
    if (cfg.promptOverride) return cfg.promptOverride
    try {
      const stored = await fetchStaticPrompt()
      if (stored) return stored
    } catch {}
    return STATIC_PROMPT_FALLBACK
  }, [])

  const refreshCtxSize = useCallback(async () => {
    try {
      const cfg = configRef.current
      const base = await getStaticPrompt()
      const dyn = await buildTerminalContext(cfg, { quick: cfg.mode === 'quick' })
      setCtxChars((base + dyn).length)
    } catch {}
  }, [getStaticPrompt])

  useEffect(() => {
    runBoot(false)
    refreshCtxSize()
    return clearBootTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remote sync applied on another device → re-read config (skin/budgets/prompt).
  useEffect(() => {
    const onSync = () => setConfig(loadOverseerConfig())
    window.addEventListener('sync-applied', onSync)
    return () => window.removeEventListener('sync-applied', onSync)
  }, [])

  // ONE storeSet per command gesture.
  const applyConfigPatch = useCallback((patch) => {
    const cur = configRef.current
    const next = sanitizeConfig({
      ...cur, ...patch,
      context: { ...cur.context, ...(patch.context || {}) },
    })
    configRef.current = next
    setConfig(next)
    saveOverseerConfig(next)
    if (patch.context || patch.mode || 'promptOverride' in patch) refreshCtxSize()
  }, [refreshCtxSize])

  const flashVerdict = useCallback(() => {
    setVerdictFlash(true)
    clearTimeout(verdictTimerRef.current)
    verdictTimerRef.current = setTimeout(() => setVerdictFlash(false), 1100)
  }, [])

  const doClear = useCallback(() => {
    sessionIdRef.current = crypto.randomUUID()
    itemsRef.current = []
    setItems([])
    recallHitsRef.current = null
    recalledRef.current = null
    lastRequestRef.current = null
    introRef.current = false
    setLastModel(null)
    runBoot(true)
  }, [runBoot])

  const runExport = useCallback(async () => {
    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey) {
      appendItems([{ kind: 'err', text: 'error: API key not set — add your Anthropic key in Settings ⚙.' }])
      return
    }
    appendItems([{ kind: 'sys', text: 'generating context package…' }])
    try {
      const dyn = await buildTerminalContext(configRef.current, { quick: false })
      const pkg = await generateContextPackage(apiKey, dyn)
      appendItems([{ kind: 'export', text: pkg }])
    } catch (e) {
      appendItems([{ kind: 'err', text: `error: export failed — ${e.message || 'unknown'}` }])
    }
  }, [appendItems])

  const openPromptEditor = useCallback(async () => {
    const current = await getStaticPrompt()
    setPromptEdit({ text: current })
    setTimeout(() => editorRef.current?.focus(), 60)
  }, [getStaticPrompt])

  const savePromptEdit = useCallback(() => {
    const text = promptEdit?.text ?? ''
    applyConfigPatch({ promptOverride: text.trim() ? text : null })
    appendItems([{
      kind: 'sys',
      text: text.trim()
        ? `prompt override saved (${text.length} chars) — /prompt reset to revert.`
        : 'empty override — cleared to settings-table prompt.',
    }])
    setPromptEdit(null)
    setTimeout(() => inputRef.current?.focus(), 60)
  }, [promptEdit, applyConfigPatch, appendItems])

  const cancelPromptEdit = useCallback(() => {
    appendItems([{ kind: 'sys', text: 'prompt edit cancelled.' }])
    setPromptEdit(null)
    setTimeout(() => inputRef.current?.focus(), 60)
  }, [appendItems])

  // ── Slash commands ──
  const handleCommand = useCallback(async (line) => {
    let result
    try {
      result = await runCommand(line, {
        config: configRef.current,
        recallHits: recallHitsRef.current,
        lastRequest: lastRequestRef.current,
        getStaticPrompt,
        getDynamicContext: () => buildTerminalContext(configRef.current, { quick: configRef.current.mode === 'quick' }),
      })
    } catch (e) {
      appendItems([{ kind: 'err', text: `error: ${e.message || 'command failed'}` }])
      return
    }
    if (result.blocks?.length) appendItems(result.blocks)
    const a = result.actions || {}
    if (a.configPatch) applyConfigPatch(a.configPatch)
    if (a.recallHits) recallHitsRef.current = a.recallHits
    if (a.recalled) recalledRef.current = a.recalled
    if (a.promptEdit) openPromptEditor()
    if (a.clear) doClear()
    if (a.export) runExport()
  }, [appendItems, applyConfigPatch, openPromptEditor, doClear, runExport, getStaticPrompt])

  // ── Chat send (streaming) ──
  const sendChat = useCallback(async (text) => {
    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey) {
      appendItems([{ kind: 'err', text: 'error: API key not set — add your Anthropic key in Settings ⚙.' }])
      return
    }
    const cfg = configRef.current
    const model = cfg.model === 'auto' ? selectModel(text, cfg.mode) : MODEL_IDS[cfg.model]
    setLastModel(model)
    setStreaming(true)
    flashedRef.current = false

    try {
      const base = await getStaticPrompt()
      let recalledBlock = ''
      if (recalledRef.current) {
        const r = recalledRef.current
        recalledBlock = `\n\n## REFERENCED PAST CONVERSATION (${r.date})\nUser: ${r.user}\nOverseer: ${r.assistant}`
      }
      const dyn = await buildTerminalContext(cfg, { quick: cfg.mode === 'quick' })
      const system = base + recalledBlock + dyn
      setCtxChars(system.length)

      // Chat history from the transcript (commands excluded), folded so roles
      // alternate (a failed send can leave two user turns back-to-back).
      const chat = []
      itemsRef.current.forEach(it => {
        if (it.kind === 'prompt' && !it.cmd && it.text) chat.push({ role: 'user', content: it.text })
        else if (it.kind === 'resp' && it.text) chat.push({ role: 'assistant', content: it.text })
      })
      const folded = []
      chat.forEach(m => {
        const last = folded[folded.length - 1]
        if (last && last.role === m.role) last.content += '\n\n' + m.content
        else folded.push({ ...m })
      })
      while (folded.length && folded[0].role !== 'user') folded.shift()
      let recent = folded.slice(-cfg.context.messages)
      if (recent.length && recent[0].role !== 'user') recent = recent.slice(1)

      const respItem = appendItems([{ kind: 'resp', text: '', model, done: false }])[0]

      lastRequestRef.current = {
        url: ANTHROPIC_URL,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': '<redacted>',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: { model, max_tokens: maxTokensForModel(model), stream: true, system, messages: recent },
      }

      await callOverseer({
        apiKey,
        systemPrompt: system,
        messages: recent,
        model,
        historyWindow: recent.length || 1,
        onChunk: (chunk) => {
          updateItem(respItem.id, it => ({ ...it, text: it.text + chunk }))
          if (!flashedRef.current) {
            const t = itemsRef.current.find(x => x.id === respItem.id)?.text || ''
            if (/(^|\n)\s*(?:►|verdict\b)/i.test(t)) { flashedRef.current = true; flashVerdict() }
          }
        },
        onDone: (fullText) => {
          saveMessage({ sessionId: sessionIdRef.current, role: 'user', content: text })
          saveMessage({ sessionId: sessionIdRef.current, role: 'assistant', content: fullText, modelUsed: model })
        },
      })
      updateItem(respItem.id, it => ({ ...it, done: true }))
    } catch (e) {
      console.error('[OverseerTerminal]', e)
      itemsRef.current = itemsRef.current.map(it => (it.kind === 'resp' && !it.done ? { ...it, done: true } : it))
      setItems(itemsRef.current)
      appendItems([{ kind: 'err', text: `error: ${e.message || 'request failed'}` }])
    } finally {
      setStreaming(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [appendItems, updateItem, getStaticPrompt, flashVerdict])

  const handleSubmit = useCallback(async () => {
    if (boot.active) finishBoot()
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    const isCmd = text.startsWith('/')
    appendItems([{ kind: 'prompt', text, cmd: isCmd }])
    if (isCmd) await handleCommand(text)
    else await sendChat(text)
  }, [input, streaming, boot.active, finishBoot, appendItems, handleCommand, sendChat])

  const onInputKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const onEditorKey = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); savePromptEdit() }
    else if (e.key === 'Escape') { e.stopPropagation(); cancelPromptEdit() }
  }, [savePromptEdit, cancelPromptEdit])

  const onScreenClick = useCallback(() => {
    if (promptEdit) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    inputRef.current?.focus()
  }, [promptEdit])

  const spriteState = verdictFlash ? 'verdict' : streaming ? 'thinking' : 'idle'
  const statusModel = lastModel ? (MODEL_LABEL[lastModel] || lastModel) : config.model

  const renderItem = (it) => {
    switch (it.kind) {
      case 'prompt': return <PromptLine key={it.id} text={it.text} />
      case 'resp':   return <div key={it.id} className="ovt-resp">{renderPhosphor(it.text, !it.done)}</div>
      case 'sys':    return <div key={it.id} className="ovt-sys">{it.text}</div>
      case 'tbl':    return <div key={it.id} className="ovt-tblwrap"><pre className="ovt-tbl">{it.text}</pre></div>
      case 'err':    return <div key={it.id} className="ovt-err">!! {it.text}</div>
      case 'dim':    return <div key={it.id} className="ovt-dimline">{it.text}</div>
      case 'export': return <ExportBlock key={it.id} text={it.text} />
      default:       return null
    }
  }

  return (
    <div className="ovt-root" onPointerDown={boot.active ? finishBoot : undefined}>
      <div className="ovt-glow" aria-hidden="true" />

      <div className="ovt-head">
        <span className="ovt-eyebrow">OVERSEER</span>
      </div>

      <div className="ovt-screen" ref={screenRef} onClick={onScreenClick}>
        {items.map(renderItem)}
        {boot.active && (
          <div className="ovt-boot">
            <PromptLine text="overseer --boot" />
            {boot.step >= 1 && (
              <div className="ovt-boot-bar">
                {'▓'.repeat(boot.bar)}{'░'.repeat(BAR_SLOTS - boot.bar)}
                {'  loading context · goals · health · calendar'}
              </div>
            )}
            {boot.step >= 2 && (
              <div className="ovt-boot-stage">
                <OvtSprite skin={config.skin} state="idle" scale={1.25} />
              </div>
            )}
            {boot.step >= 3 && <div className="ovt-online">▪ companion online.</div>}
          </div>
        )}
      </div>

      <div className="ovt-chips">
        {CHIPS.map(c => (
          <button
            key={c}
            type="button"
            className="ovt-chip"
            onClick={() => { setInput(c + ' '); inputRef.current?.focus() }}
          >{c}</button>
        ))}
      </div>

      <div className="ovt-status">
        <span className="ovt-status-item">model {statusModel}</span>
        <span className="ovt-status-sep">·</span>
        <span className="ovt-status-item">ctx {ctxChars != null ? `${(ctxChars / 1000).toFixed(1)}k` : '…'}</span>
        <span className="ovt-status-sep">·</span>
        <span className="ovt-status-item">mode {config.mode}</span>
        <span className="ovt-status-sprite">
          {!boot.active && <OvtSprite skin={config.skin} state={spriteState} scale={0.3} />}
        </span>
      </div>

      <div className="ovt-inputrow">
        {promptEdit ? (
          <div className="ovt-editor-wrap">
            <textarea
              ref={editorRef}
              className="ovt-editor"
              value={promptEdit.text}
              onChange={e => setPromptEdit({ text: e.target.value })}
              onKeyDown={onEditorKey}
              spellCheck={false}
            />
            <div className="ovt-editor-hint">editing static prompt — ctrl+enter save · esc cancel</div>
          </div>
        ) : (
          <>
            <span className="ovt-ps">dane@overseer<span className="ovt-ps-dim">:~ $</span></span>
            <input
              ref={inputRef}
              className="ovt-input"
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onInputKey}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Terminal input"
            />
          </>
        )}
      </div>

      <div className="ovt-scan" aria-hidden="true" />
    </div>
  )
}
