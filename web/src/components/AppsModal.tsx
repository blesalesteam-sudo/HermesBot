import { useEffect, useState } from 'react'

import { IconBack, IconCheck, IconSearch, IconX } from './icons'

// Catálogo de conexiones. Hermes ya sabe configurar varias de ellas por sí mismo: el botón
// "Pedírselo a Hermes" deja escrita la petición en el chat para que el bot guíe el proceso.
// La conexión con un clic (código QR, botones de autorizar) llega en la siguiente fase.
interface App {
  id: string
  name: string
  desc: string
  color: string
  cat: string
  what: string[]
  steps: string[]
  ask: string
}

const APPS: App[] = [
  {
    id: 'whatsapp', name: 'WhatsApp', desc: 'Escanea un código QR y elige qué grupos escucha', color: '#25a35a', cat: 'Comunicación',
    what: ['Leer los grupos de trabajo que elijáis', 'Resumir conversaciones largas', 'Avisaros de acuerdos y tareas que salgan en el grupo'],
    steps: ['Abrís este panel y pulsáis Conectar', 'Escaneáis el código QR con el móvil, como en WhatsApp Web', 'Marcáis qué grupos puede escuchar el bot'],
    ask: 'Quiero conectar WhatsApp para que escuches nuestros grupos de trabajo. Explícame qué necesitas y guíame paso a paso.'
  },
  {
    id: 'telegram', name: 'Telegram', desc: 'Conecta vuestro bot y elige los grupos de trabajo', color: '#2b9fd9', cat: 'Comunicación',
    what: ['Hablar con el bot desde Telegram', 'Recibir avisos y resúmenes en un grupo', 'Capturar tareas de los grupos de trabajo'],
    steps: ['Creáis un bot en Telegram con BotFather (2 minutos)', 'Pegáis aquí el código que os da', 'Añadís el bot a los grupos que queráis'],
    ask: 'Quiero conectar Telegram. Explícame qué necesitas de mí y guíame paso a paso.'
  },
  {
    id: 'notion', name: 'Notion', desc: 'Guarda tareas y acuerdos en vuestra tabla', color: '#55534e', cat: 'Productividad',
    what: ['Crear tareas y notas en vuestras tablas', 'Buscar información en vuestras páginas', 'Guardar los acuerdos de cada reunión'],
    steps: ['Pulsáis Conectar y entráis en vuestra cuenta de Notion', 'Elegís qué páginas puede ver el bot', 'Le decís en qué tabla guardar las tareas'],
    ask: 'Quiero conectar Notion para que guardes tareas y acuerdos en nuestra tabla. Guíame paso a paso.'
  },
  {
    id: 'calendar', name: 'Calendario', desc: 'Consulta y crea eventos', color: '#d9534f', cat: 'Productividad',
    what: ['Ver vuestros huecos libres', 'Proponer y crear reuniones', 'Recordaros lo que viene mañana'],
    steps: ['Pulsáis Conectar y elegís vuestra cuenta', 'Decidís si solo puede leer o también crear eventos'],
    ask: 'Quiero conectar nuestro calendario para que consultes y crees eventos. ¿Qué necesitas?'
  },
  {
    id: 'drive', name: 'Documentos', desc: 'Busca y lee vuestros archivos', color: '#e0a100', cat: 'Productividad',
    what: ['Buscar entre vuestros documentos', 'Leer y resumir archivos', 'Preparar borradores a partir de plantillas'],
    steps: ['Pulsáis Conectar y elegís la cuenta', 'Marcáis qué carpetas puede ver'],
    ask: 'Quiero darte acceso a nuestros documentos. Explícame las opciones y guíame.'
  },
  {
    id: 'mcp', name: 'Herramienta externa', desc: 'Añade cualquier herramienta compatible con Hermes', color: '#6d5bd0', cat: 'Capacidades',
    what: ['Conectar el CRM, la facturación u otras herramientas', 'Dar al bot acciones nuevas sin programar'],
    steps: ['Le pasáis al bot la dirección de la herramienta', 'El bot la añade y os enseña qué puede hacer con ella'],
    ask: 'Quiero añadir una herramienta externa (servidor MCP). Dime qué datos necesitas y configúrala tú.'
  },
  {
    id: 'skills', name: 'Habilidades', desc: 'Activa o instala habilidades de Hermes', color: '#2f9e8f', cat: 'Capacidades',
    what: ['Enseñar al bot una forma de trabajar', 'Reutilizar procesos que ya os funcionan'],
    steps: ['Le explicáis el proceso con vuestras palabras', 'El bot lo guarda como habilidad y lo usa cuando toque'],
    ask: 'Enséñame qué habilidades tienes instaladas y cuáles nos vendría bien añadir.'
  },
  {
    id: 'voz', name: 'Voz', desc: 'Dicta mensajes y escucha las respuestas', color: '#D84F8B', cat: 'Capacidades',
    what: ['Dictar con el micrófono de la caja de escribir', 'Pedir al bot que responda con audio'],
    steps: ['Pulsáis el micrófono junto al botón de enviar', 'Dais permiso al navegador la primera vez'],
    ask: '¿Puedes responderme con audio además de con texto? Explícame cómo activarlo.'
  }
]
const CATS = ['Todos', 'Comunicación', 'Productividad', 'Capacidades']

export function AppsModal({ onClose, onAsk }: { onClose: () => void; onAsk: (text: string) => void }) {
  const [cat, setCat] = useState('Todos')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<App | null>(null)
  const list = APPS.filter(a => (cat === 'Todos' || a.cat === cat) && `${a.name} ${a.desc}`.toLowerCase().includes(q.trim().toLowerCase()))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (open) { setOpen(null) } else { onClose() } }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Conectar aplicaciones" onClick={e => e.stopPropagation()}>
        {open ? (
          <div className="app-detail" key={open.id}>
            <div className="modal-head">
              <button className="round-btn ghost" onClick={() => setOpen(null)} aria-label="Volver"><IconBack width={17} height={17} /></button>
              <button className="round-btn ghost" onClick={onClose} aria-label="Cerrar"><IconX width={17} height={17} /></button>
            </div>
            <div className="app-hero">
              <span className="app-icon big" style={{ ['--c' as string]: open.color }}>{open.name[0]}</span>
              <div>
                <h2>{open.name}</h2>
                <p>{open.desc}</p>
              </div>
            </div>
            <div className="app-cols">
              <div>
                <h3>Qué podrá hacer el bot</h3>
                <ul className="checks">
                  {open.what.map(w => <li key={w}><IconCheck width={15} height={15} />{w}</li>)}
                </ul>
              </div>
              <div>
                <h3>Cómo se conecta</h3>
                <ol className="steps">
                  {open.steps.map((s, i) => <li key={s}><b>{i + 1}</b>{s}</li>)}
                </ol>
              </div>
            </div>
            <div className="app-cta">
              <button className="btn btn-primary" onClick={() => onAsk(open.ask)}>Pedírselo a Hermes</button>
              <span>Deja la petición escrita en el chat para que el bot os guíe.</span>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-head">
              <h2>Conectar aplicaciones</h2>
              <button className="round-btn ghost" onClick={onClose} aria-label="Cerrar"><IconX width={17} height={17} /></button>
            </div>
            <p className="modal-sub">Dale al equipo de bots acceso a las herramientas que ya usáis.</p>
            <label className="search modal-search">
              <IconSearch width={16} height={16} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar aplicaciones y habilidades" aria-label="Buscar aplicaciones" autoFocus />
            </label>
            <div className="chips">
              {CATS.map(c => <button key={c} className={`chip${c === cat ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
            </div>
            <div className="apps-grid">
              {list.map(a => (
                <button key={a.id} className="app-row" onClick={() => setOpen(a)}>
                  <span className="app-icon" style={{ ['--c' as string]: a.color }}>{a.name[0]}</span>
                  <span className="app-text">
                    <span className="app-name">{a.name}</span>
                    <span className="app-desc">{a.desc}</span>
                  </span>
                  <span className="btn small">Ver</span>
                </button>
              ))}
              {list.length === 0 && <p className="empty-hint">Nada coincide con la búsqueda.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
