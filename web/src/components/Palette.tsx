import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { IconSearch } from './icons'

export interface PaletteAction {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

/** Acciones rápidas con el teclado (Ctrl o Cmd + K): cambiar de bot, tema, panel… */
export function Palette({ actions, onClose }: { actions: PaletteAction[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()

    return needle ? actions.filter(a => `${a.label} ${a.hint ?? ''}`.toLowerCase().includes(needle)) : actions
  }, [q, actions])

  useEffect(() => { setAt(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const run = (a?: PaletteAction) => {
    if (a) {
      onClose()
      a.run()
    }
  }

  return (
    <div className="modal-back top" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Acciones rápidas" onClick={e => e.stopPropagation()}>
        <label className="palette-input">
          <IconSearch width={17} height={17} />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="¿Qué quieres hacer?"
            aria-label="Buscar una acción"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(i + 1, list.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(i - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); run(list[at]) }
              if (e.key === 'Escape') { onClose() }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" ref={listRef}>
          {list.map((a, i) => (
            <button key={a.id} className={`palette-item${i === at ? ' on' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => run(a)}>
              <span className="palette-icon">{a.icon}</span>
              <span>{a.label}</span>
              {a.hint && <small>{a.hint}</small>}
            </button>
          ))}
          {list.length === 0 && <p className="empty-hint">No hay ninguna acción con ese nombre.</p>}
        </div>
      </div>
    </div>
  )
}
