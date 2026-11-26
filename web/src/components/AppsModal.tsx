import { useState } from 'react'

import { IconSearch, IconX } from './icons'

// Panel visual de "Conectar aplicaciones". En la Fase 1 es solo el diseño: las conexiones
// reales (Telegram, WhatsApp con código QR, Notion y los servidores MCP de Hermes) llegan
// en la siguiente fase.
const APPS = [
  { id: 'whatsapp', name: 'WhatsApp', desc: 'Escanea un código QR y elige qué grupos escucha', color: '#25a35a', cat: 'Comunicación' },
  { id: 'telegram', name: 'Telegram', desc: 'Conecta vuestro bot y elige los grupos de trabajo', color: '#2b9fd9', cat: 'Comunicación' },
  { id: 'notion', name: 'Notion', desc: 'Guarda tareas y acuerdos en vuestra tabla', color: '#55534e', cat: 'Productividad' },
  { id: 'calendar', name: 'Calendario', desc: 'Consulta y crea eventos', color: '#d9534f', cat: 'Productividad' },
  { id: 'drive', name: 'Documentos', desc: 'Busca y lee vuestros archivos', color: '#e0a100', cat: 'Productividad' },
  { id: 'mcp', name: 'Servidor MCP', desc: 'Añade cualquier herramienta compatible con Hermes', color: '#6d5bd0', cat: 'Capacidades' },
  { id: 'skills', name: 'Skills', desc: 'Activa o instala habilidades de Hermes', color: '#2f9e8f', cat: 'Capacidades' },
  { id: 'plugins', name: 'Plugins', desc: 'Amplía lo que el agente puede hacer', color: '#E78531', cat: 'Capacidades' }
]
const CATS = ['Todos', 'Comunicación', 'Productividad', 'Capacidades']

export function AppsModal({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState('Todos')
  const [q, setQ] = useState('')
  const list = APPS.filter(a => (cat === 'Todos' || a.cat === cat) && `${a.name} ${a.desc}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Conectar aplicaciones" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Conectar aplicaciones</h2>
          <button className="round-btn" onClick={onClose} aria-label="Cerrar"><IconX width={17} height={17} /></button>
        </div>
        <label className="search modal-search">
          <IconSearch width={16} height={16} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en aplicaciones y habilidades" aria-label="Buscar aplicaciones" />
        </label>
        <div className="chips">
          {CATS.map(c => <button key={c} className={`chip${c === cat ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="apps-grid">
          {list.map(a => (
            <div key={a.id} className="app-row">
              <span className="app-icon" style={{ background: a.color }}>{a.name[0]}</span>
              <span className="app-text">
                <span className="app-name">{a.name}</span>
                <span className="app-desc">{a.desc}</span>
              </span>
              <button className="btn small" disabled title="Disponible en la siguiente fase">Conectar</button>
            </div>
          ))}
          {list.length === 0 && <p className="empty-hint">Nada coincide con la búsqueda.</p>}
        </div>
        <p className="modal-foot">Vista previa del panel. Las conexiones reales se activan en la siguiente fase.</p>
      </div>
    </div>
  )
}
