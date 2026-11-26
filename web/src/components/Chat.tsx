import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { SUGGESTIONS } from '../../shared/defaults'
import type { Bot, ClientCommand, Upload } from '../../shared/protocol'
import { dayLabel, fileSize } from '../lib/format'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconBack, IconClock, IconDown, IconFile, IconImage, IconMic, IconPanel, IconPlus, IconSend, IconStop, IconX } from './icons'
import { Message } from './Message'
import { RequestCard } from './RequestCard'

interface Props {
  state: ClientState
  bot: Bot
  send: (cmd: ClientCommand) => void
  panelOpen: boolean
  onTogglePanel: () => void
  onBack: () => void
  /** Texto que otra parte de la app quiere dejar escrito en la caja (ideas, rutinas…). */
  prefill: { text: string; n: number } | null
}

const MAX_FILES = 6
const MAX_BYTES = 8 * 1024 * 1024

function senderKey(m: { role: string; authorId?: string }) {
  return m.role === 'user' ? `u:${m.authorId}` : m.role
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/** Miniatura ligera de una imagen, para enseñarla en el chat sin guardar el original. */
const thumbnail = (dataUrl: string) =>
  new Promise<string | undefined>(resolve => {
    const img = new Image()

    img.onload = () => {
      const scale = Math.min(1, 560 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')

      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })

type Recognition = { start(): void; stop(): void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }

function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>

  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null
}

export function Chat({ state, bot, send, panelOpen, onTogglePanel, onBack, prefill }: Props) {
  const [draft, setDraft] = useState('')
  const [uploads, setUploads] = useState<(Upload & { id: string })[]>([])
  const [hint, setHint] = useState('')
  const [menu, setMenu] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const [away, setAway] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const typingSent = useRef(false)
  const typingTimer = useRef<number>()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const recognition = useRef<Recognition | null>(null)
  const dictationBase = useRef('')

  const messages = state.messages[bot.id] ?? []
  const requests = state.requests.filter(r => r.botId === bot.id)
  const status = state.status[bot.id]
  const working = !!status && status.state !== 'idle'
  const typers = (state.typing[bot.id] ?? []).filter(id => id !== state.me.id)
  const lastLen = messages.length ? messages[messages.length - 1]!.text.length : 0
  const canSend = draft.trim().length > 0 || uploads.length > 0

  useLayoutEffect(() => {
    const el = scroller.current

    if (el && stick.current) { el.scrollTop = el.scrollHeight }
  }, [messages.length, lastLen, requests.length, typers.length, working])

  useEffect(() => {
    textarea.current?.focus({ preventScroll: true })

    return () => recognition.current?.stop()
  }, [])

  useEffect(() => {
    if (prefill) {
      setDraft(prefill.text)
      textarea.current?.focus()
    }
  }, [prefill])

  useEffect(() => {
    const el = textarea.current

    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
  }, [draft])

  useEffect(() => {
    if (!hint) { return }

    const t = window.setTimeout(() => setHint(''), 4500)

    return () => window.clearTimeout(t)
  }, [hint])

  const setTyping = (on: boolean) => {
    if (typingSent.current !== on) {
      typingSent.current = on
      send({ t: 'typing', botId: bot.id, on })
    }
  }

  const onChange = (v: string) => {
    setDraft(v)
    setTyping(v.trim().length > 0)
    window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => setTyping(false), 4000)
  }

  const addFiles = async (files: File[]) => {
    const room = MAX_FILES - uploads.length
    const ok = files.filter(f => f.size <= MAX_BYTES).slice(0, Math.max(0, room))

    if (ok.length < files.length) {
      setHint(`Puedes adjuntar hasta ${MAX_FILES} archivos de 8 MB como máximo cada uno.`)
    }

    for (const file of ok) {
      try {
        const data = await readAsDataUrl(file)
        const preview = file.type.startsWith('image/') ? await thumbnail(data) : undefined

        setUploads(list => [...list, { id: `${Date.now()}-${Math.random()}`, name: file.name || 'imagen.png', type: file.type || 'application/octet-stream', size: file.size, data, preview }])
      } catch {
        setHint(`No pude leer "${file.name}".`)
      }
    }
  }

  const submit = (text = draft.trim()) => {
    if (!text && !uploads.length) { return }

    send({ t: 'send', botId: bot.id, text, uploads: uploads.length ? uploads.map(({ id: _id, ...u }) => u) : undefined })
    setDraft('')
    setUploads([])
    setTyping(false)
    recognition.current?.stop()
    stick.current = true
    setAway(false)
  }

  const toggleDictation = () => {
    if (listening) {
      recognition.current?.stop()

      return
    }

    const Ctor = speechRecognition()

    if (!Ctor) {
      setHint('Tu navegador no permite dictar por voz. Prueba con Chrome, Edge o Safari.')

      return
    }

    const rec = new Ctor()

    rec.lang = 'es-ES'
    rec.interimResults = true
    rec.continuous = true
    dictationBase.current = draft ? `${draft.trimEnd()} ` : ''
    rec.onresult = e => {
      let said = ''

      for (let i = 0; i < e.results.length; i++) { said += e.results[i][0].transcript }
      onChange(dictationBase.current + said)
    }
    rec.onend = () => { setListening(false); recognition.current = null }
    rec.onerror = () => { setHint('No pude usar el micrófono. Revisa el permiso del navegador.'); setListening(false) }
    recognition.current = rec

    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  const toBottom = () => {
    const el = scroller.current

    if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }
  }

  const typerNames = typers.map(id => state.users.find(u => u.id === id)?.name ?? 'Tu socio')
  const suggestions = SUGGESTIONS[bot.id] ?? SUGGESTIONS.hermes!

  return (
    <section
      className={`chat${dragging ? ' dragging' : ''}`}
      style={{ ['--bot' as string]: bot.color }}
      aria-label={`Conversación con ${bot.name}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) { setDragging(false) } }}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <div className="chat-glow" aria-hidden="true" />
      <div className="chat-float">
        <button className="round-btn only-mobile" onClick={onBack} aria-label="Volver a los bots"><IconBack width={18} height={18} /></button>
        <span className="chat-float-spacer" />
        <button className="bot-pill" onClick={onTogglePanel} aria-label="Ver detalles de la conversación" title="Ver detalles">
          <Avatar name={bot.name} color={bot.color} size={26} status={working ? 'busy' : null} />
          <span className="bot-pill-text">
            <span className="bot-pill-name">{bot.name}</span>
            <span className={`bot-pill-sub${working ? ' live' : ''}`}>{working ? status?.label || 'Trabajando…' : bot.role}</span>
          </span>
        </button>
        <span className="chat-float-spacer right">
          {state.hermes === 'demo' && <span className="conn-chip demo">Vista previa</span>}
          {state.hermes === 'connecting' && <span className="conn-chip" title={state.hermesDetail}>Conectando con Hermes…</span>}
          {state.hermes === 'offline' && <span className="conn-chip" title={state.hermesDetail}>Hermes no responde</span>}
          <button className={`round-btn no-mobile${panelOpen ? ' on' : ''}`} onClick={onTogglePanel} aria-label="Panel de detalles" title="Panel de detalles"><IconPanel width={17} height={17} /></button>
        </span>
      </div>

      <div
        className="transcript"
        ref={scroller}
        onScroll={e => {
          const el = e.currentTarget
          const gap = el.scrollHeight - el.scrollTop - el.clientHeight

          stick.current = gap < 80
          setAway(gap > 320)
        }}
      >
        <div className="transcript-inner">
          {messages.length === 0 && (
            <div className="welcome">
              <span className="welcome-avatar"><Avatar name={bot.name} color={bot.color} size={76} /></span>
              <h2>{bot.name}</h2>
              <p>{bot.role}</p>
              <div className="suggestions">
                {suggestions.map(s => (
                  <button key={s} className="suggestion" onClick={() => submit(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const next = messages[i + 1]
            const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()
            const first = newDay || !prev || senderKey(prev) !== senderKey(m)
            const last = !next || senderKey(next) !== senderKey(m) || new Date(next.ts).toDateString() !== new Date(m.ts).toDateString()

            return (
              <Fragment key={m.id}>
                {newDay && <div className="day"><span>{dayLabel(m.ts)}</span></div>}
                <Message msg={m} me={state.me} users={state.users} first={first} last={last} />
              </Fragment>
            )
          })}
          {requests.map(r => <RequestCard key={r.id} req={r} send={send} />)}
          {working && requests.length === 0 && (
            <div className="activity">
              <span className="activity-orb" />
              <span className="shimmer">{status?.label || 'Pensando…'}</span>
            </div>
          )}
          {typerNames.length > 0 && (
            <div className="typing-line">
              <span className="dots"><i /><i /><i /></span>
              {typerNames.join(' y ')} {typerNames.length > 1 ? 'están' : 'está'} escribiendo…
            </div>
          )}
        </div>
      </div>

      <form className="composer-wrap" onSubmit={e => { e.preventDefault(); submit() }}>
        {away && (
          <button type="button" className="to-bottom" onClick={toBottom} aria-label="Ir al final"><IconDown width={16} height={16} /></button>
        )}
        {hint && <p className="composer-hint" role="status">{hint}</p>}
        <div className={`composer${listening ? ' listening' : ''}`}>
          {uploads.length > 0 && (
            <div className="upload-row">
              {uploads.map(u => (
                <div key={u.id} className={`upload${u.preview ? ' image' : ''}`}>
                  {u.preview ? <img src={u.preview} alt="" /> : <span className="upload-icon"><IconFile width={18} height={18} /></span>}
                  {!u.preview && (
                    <span className="upload-text">
                      <span className="upload-name">{u.name}</span>
                      <span className="upload-size">{fileSize(u.size)}</span>
                    </span>
                  )}
                  <button type="button" className="upload-x" onClick={() => setUploads(list => list.filter(x => x.id !== u.id))} aria-label={`Quitar ${u.name}`}><IconX width={12} height={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="composer-line">
            <div className="plus-wrap">
              <button type="button" className={`composer-btn${menu ? ' on' : ''}`} onClick={() => setMenu(m => !m)} aria-label="Añadir" aria-expanded={menu} title="Añadir"><IconPlus width={18} height={18} /></button>
              {menu && (
                <>
                  <div className="scrim" onClick={() => setMenu(false)} />
                  <div className="menu up" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); if (picker.current) { picker.current.accept = 'image/*'; picker.current.click() } }}>
                      <IconImage width={16} height={16} /> Foto o imagen
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); if (picker.current) { picker.current.accept = ''; picker.current.click() } }}>
                      <IconFile width={16} height={16} /> Archivo
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); onChange('Crea una rutina: cada lunes a las 9:00 '); textarea.current?.focus() }}>
                      <IconClock width={16} height={16} /> Programar una rutina
                    </button>
                  </div>
                </>
              )}
            </div>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={e => {
                void addFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <textarea
              ref={textarea}
              rows={1}
              value={draft}
              onChange={e => onChange(e.target.value)}
              onPaste={e => {
                const files = [...e.clipboardData.files]

                if (files.length) {
                  e.preventDefault()
                  void addFiles(files)
                }
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={listening ? 'Te escucho…' : `Escríbele a ${bot.name}`}
              aria-label="Mensaje"
            />
            <button type="button" className={`composer-btn mic${listening ? ' on' : ''}`} onClick={toggleDictation} aria-label={listening ? 'Dejar de dictar' : 'Dictar por voz'} aria-pressed={listening} title={listening ? 'Dejar de dictar' : 'Dictar por voz'}>
              <IconMic width={18} height={18} />
            </button>
            {working && !canSend ? (
              <button type="button" className="send stop" onClick={() => send({ t: 'stop', botId: bot.id })} aria-label="Detener" title="Detener">
                <IconStop width={16} height={16} />
              </button>
            ) : (
              <button type="submit" className="send" disabled={!canSend} aria-label="Enviar" title="Enviar">
                <IconSend width={17} height={17} />
              </button>
            )}
          </div>
        </div>
        <p className="composer-foot">Intro para enviar · Mayús + Intro para saltar de línea · arrastra archivos aquí</p>
      </form>

      {dragging && (
        <div className="drop-veil" aria-hidden="true">
          <div className="drop-card"><IconImage width={26} height={26} /><span>Suelta para adjuntar</span></div>
        </div>
      )}
    </section>
  )
}
