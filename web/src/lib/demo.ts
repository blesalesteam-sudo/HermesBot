// Modo demostración: simula el servidor y a Hermes dentro del navegador, con datos de
// prueba, para poder enseñar y probar el diseño sin desplegar nada.
import { DEFAULT_BOTS } from '../../shared/defaults'
import type {
  ChatMessage, ClientCommand, PendingRequest, Routine, ServerEvent, Snapshot, ToolCall, Upload, User
} from '../../shared/protocol'
import type { Connection } from './connection'

export const DEMO_USERS: User[] = [
  { id: 'socio-1', name: 'Alex', color: '#8d69ce', username: 'alex', admin: true },
  { id: 'socio-2', name: 'Sam', color: '#0EA5C6', username: 'sam', admin: true }
]

const min = 60_000
let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function seed(): Record<string, ChatMessage[]> {
  const now = Date.now()

  return {
    'chief-of-staff': [
      { id: 'a1', role: 'user', authorId: 'socio-2', text: '¿Qué tenemos pendiente esta semana con los clientes nuevos?', ts: now - 42 * min },
      {
        id: 'a2', role: 'assistant', ts: now - 41 * min,
        tools: [
          { id: 't1', name: 'session_search', label: 'Revisó conversaciones anteriores', status: 'done' },
          { id: 't2', name: 'memory', label: 'Consultó la memoria del equipo', status: 'done' },
          { id: 't3', name: 'todo', label: 'Ordenó la lista de tareas', status: 'done' }
        ],
        text:
          'Esto es lo que tenéis pendiente esta semana:\n\n' +
          '1. **Propuesta para Clínica Norte**: falta enviar el presupuesto final (quedasteis en el jueves).\n' +
          '2. **Llamada de arranque con Estudio Vega**: sin fecha todavía.\n' +
          '3. **Factura de noviembre** de Grupo Lumen: pendiente de revisar.\n\n' +
          '¿Queréis que os proponga un hueco para la llamada con Estudio Vega?'
      },
      { id: 'a3', role: 'user', authorId: 'socio-1', text: 'Sí, propón el miércoles por la mañana. Y pásanos cómo va cada cliente.', ts: now - 39 * min },
      {
        id: 'a4', role: 'assistant', ts: now - 39 * min,
        tools: [{ id: 't5', name: 'read_file', label: 'Leyó un archivo', status: 'done', detail: 'clientes-noviembre.xlsx' }],
        text:
          'Hecho. He propuesto el **miércoles a las 10:30** y he dejado un recordatorio para el martes por la tarde.\n\n' +
          '| Cliente | Estado | Siguiente paso |\n|---|---|---|\n' +
          '| Clínica Norte | Presupuesto | Enviar el jueves |\n' +
          '| Estudio Vega | Arranque | Llamada el miércoles |\n' +
          '| Grupo Lumen | Facturación | Revisar factura |\n\n' +
          'Tareas que he apuntado:\n\n- [x] Proponer hueco a Estudio Vega\n- [ ] Enviar presupuesto a Clínica Norte\n- [ ] Revisar la factura de Grupo Lumen'
      }
    ],
    setter: [
      { id: 'b1', role: 'user', authorId: 'socio-1', text: 'Prepárame un mensaje corto para reactivar a los leads que no contestaron en octubre.', ts: now - 3 * 60 * min },
      {
        id: 'b2', role: 'assistant', ts: now - 3 * 60 * min + 30_000,
        tools: [{ id: 't4', name: 'web_search', label: 'Buscó en la web', status: 'done' }],
        text:
          'Aquí tienes una propuesta:\n\n> Hola {nombre}, hace unas semanas hablamos sobre cómo ahorrar tiempo en la gestión de citas. ' +
          'Este mes hemos ayudado a dos clínicas a reducir las llamadas perdidas un 30 %. ¿Te va bien una llamada de 15 minutos esta semana?\n\n' +
          'Es corto, recuerda el contexto y termina con una pregunta fácil de responder.'
      }
    ],
    contenido: [],
    hermes: []
  }
}

const TOOLSETS: ToolCall[][] = [
  [
    { id: '', name: 'memory', label: 'Consultó la memoria del equipo', status: 'running' },
    { id: '', name: 'web_search', label: 'Buscó en la web', status: 'running' }
  ],
  [
    { id: '', name: 'session_search', label: 'Revisó conversaciones anteriores', status: 'running' },
    { id: '', name: 'read_file', label: 'Leyó un documento', status: 'running' },
    { id: '', name: 'todo', label: 'Ordenó la lista de tareas', status: 'running' }
  ]
]

export function connectDemo(meId: string, onEvent: (ev: ServerEvent) => void): Connection {
  const me = DEMO_USERS.find(u => u.id === meId) ?? DEMO_USERS[0]!
  const partner = DEMO_USERS.find(u => u.id !== me.id)!
  const messages = seed()
  const waiting = new Map<string, (answer: string) => void>()
  let toolset = 0
  let users: User[] = DEMO_USERS.map(u => ({ ...u }))
  let bots = DEFAULT_BOTS.map(b => ({ ...b }))
  const routines: Routine[] = [
    { id: 'r1', name: 'Prioridades del día', when: 'De lunes a viernes a las 9:00', what: 'Resumen de prioridades del día', enabled: true },
    { id: 'r2', name: 'Repaso de acuerdos', when: 'Cada viernes a las 17:00', what: 'Repaso de acuerdos de la semana', enabled: true },
    { id: 'r3', name: 'Leads sin respuesta', when: 'Cada martes a las 10:00', what: 'Lista de leads que no han contestado', enabled: false }
  ]
  let closed = false
  const timers: number[] = []

  const emit = (ev: ServerEvent) => {
    if (!closed) {
      onEvent(ev)
    }
  }
  const add = (botId: string, msg: ChatMessage) => {
    const list = messages[botId] ?? (messages[botId] = [])
    const i = list.findIndex(m => m.id === msg.id)

    if (i === -1) { list.push(msg) } else { list[i] = msg }
    emit({ t: 'msg', botId, msg: { ...msg, tools: msg.tools?.map(t => ({ ...t })) } })
  }
  const ask = (req: PendingRequest) =>
    new Promise<string>(resolve => {
      waiting.set(req.id, resolve)
      emit({ t: 'req', req })
    })

  async function reply(botId: string, text: string, uploads: Upload[] = []) {
    emit({ t: 'status', botId, status: { state: 'thinking', label: 'Pensando…' } })
    await sleep(900)

    const lower = text.toLowerCase()
    const msg: ChatMessage = { id: uid('m'), role: 'assistant', text: '', tools: [], streaming: true, ts: Date.now() }

    add(botId, msg)

    if (/borra|elimina|ejecuta|permiso|instala/.test(lower)) {
      emit({ t: 'status', botId, status: { state: 'working', label: 'Esperando vuestro permiso' } })
      const answer = await ask({
        id: uid('req'), botId, kind: 'approval',
        title: 'Hermes quiere ejecutar un comando en su ordenador',
        detail: 'Borrar archivos es irreversible, por eso pide permiso.',
        command: 'rm -rf ./borradores-antiguos'
      })

      msg.tools!.push({ id: uid('t'), name: 'terminal', label: answer === 'deny' ? 'Comando cancelado' : 'Ejecutó un comando', status: answer === 'deny' ? 'error' : 'done' })
      add(botId, msg)
      await stream(botId, msg, answer === 'deny'
        ? 'Entendido, no he borrado nada. Si cambiáis de idea, decídmelo.'
        : 'Listo: he borrado la carpeta de borradores antiguos. Quedan solo los documentos de este mes.')

      return
    }

    if (/tabla|compara|clientes/.test(lower)) {
      msg.tools!.push({ id: uid('t'), name: 'read_file', label: 'Leyó un archivo', status: 'done', detail: 'clientes-noviembre.xlsx' })
      add(botId, msg)
      await stream(botId, msg,
        'Aquí tienes la comparación:\n\n| Opción | Coste al mes | Tiempo de puesta en marcha |\n|---|---|---|\n' +
        '| Plan básico | 49 € | 1 día |\n| Plan equipo | 129 € | 3 días |\n| A medida | Desde 400 € | 2 semanas |\n\n' +
        'Mi recomendación es el **plan equipo**: cubre lo que pedís y se puede ampliar después.')

      return
    }

    if (/c[oó]digo|f[oó]rmula|script/.test(lower)) {
      await stream(botId, msg,
        'Esta fórmula calcula el total con IVA en vuestra hoja:\n\n```excel\n=SUMA(B2:B20) * 1,21\n```\n\nPuedes copiarla con el botón de arriba a la derecha del recuadro.')

      return
    }

    if (/rutina|cada (lunes|martes|mi[eé]rcoles|jueves|viernes|d[ií]a|semana)/.test(lower)) {
      msg.tools!.push({ id: uid('t'), name: 'cronjob', label: 'Gestionó una rutina', status: 'done' })
      add(botId, msg)
      routines.push({ id: uid('r'), name: text.replace(/^crea una rutina:?\s*/i, '').slice(0, 60) || 'Nueva rutina', when: 'Cada lunes a las 9:00', what: text, enabled: true })
      emit({ t: 'routines', routines: [...routines] })
      await stream(botId, msg, 'Rutina creada. La tienes en el panel de detalles, donde puedes pausarla o borrarla cuando quieras.')

      return
    }

    if (/duda|pregunta|elige|opción|opcion/.test(lower)) {
      emit({ t: 'status', botId, status: { state: 'working', label: 'Esperando vuestra respuesta' } })
      const answer = await ask({
        id: uid('req'), botId, kind: 'clarify', title: 'Hermes tiene una duda',
        question: '¿Para qué red social preparo el contenido?', choices: ['LinkedIn', 'Instagram', 'Las dos']
      })

      await stream(botId, msg, `Perfecto, lo preparo para **${answer}**. Os paso un primer borrador en unos minutos.`)

      return
    }

    if (uploads.length) {
      const images = uploads.filter(u => u.type.startsWith('image/')).length

      msg.tools!.push({ id: uid('t'), name: images ? 'vision_analyze' : 'read_file', label: images ? 'Analizó una imagen' : 'Leyó un archivo', status: 'done', detail: uploads[0]!.name })
      add(botId, msg)
      await stream(botId, msg,
        `He recibido ${uploads.length === 1 ? `**${uploads[0]!.name}**` : `los ${uploads.length} archivos`}. ` +
        'En la versión conectada, Hermes los abre de verdad: describe imágenes, lee documentos y saca datos de hojas de cálculo.')

      return
    }

    emit({ t: 'status', botId, status: { state: 'working', label: 'Usando herramientas…' } })

    for (const tool of TOOLSETS[toolset++ % TOOLSETS.length]!) {
      const t = { ...tool, id: uid('t') }

      msg.tools!.push(t)
      add(botId, msg)
      await sleep(700)
      t.status = 'done'
      add(botId, msg)
    }

    await stream(botId, msg,
      'Recibido. Esto es una **respuesta de prueba**: en la versión conectada aquí escribe Hermes en tiempo real.\n\n' +
      'Cosas que puedes probar ahora:\n\n' +
      '- Escribe *"borra"* para ver una tarjeta de permiso\n- Escribe *"duda"* para ver una pregunta con opciones\n' +
      '- Escribe *"tabla"* o *"código"* para ver respuestas con formato\n- Adjunta una foto con el botón **+** o arrastrándola al chat\n' +
      '- Pulsa el micrófono para dictar\n- Pulsa **Ctrl + K** para las acciones rápidas')
  }

  async function stream(botId: string, msg: ChatMessage, full: string) {
    emit({ t: 'status', botId, status: { state: 'working', label: 'Escribiendo…' } })

    for (const piece of full.match(/\S+\s*/g) ?? []) {
      if (closed) { return }
      msg.text += piece
      emit({ t: 'delta', botId, id: msg.id, text: piece })
      await sleep(35)
    }

    msg.streaming = false
    add(botId, msg)
    emit({ t: 'status', botId, status: { state: 'idle', lastActive: Date.now() } })
  }

  const snapshot: Snapshot = {
    me,
    users: DEMO_USERS,
    bots: DEFAULT_BOTS,
    messages: structuredClone(messages),
    status: {
      'chief-of-staff': { state: 'idle', lastActive: Date.now() - 39 * min },
      setter: { state: 'idle', lastActive: Date.now() - 180 * min },
      contenido: { state: 'idle' },
      hermes: { state: 'idle' }
    },
    requests: [],
    online: [me.id],
    hermes: 'demo',
    routines: [...routines]
  }

  queueMicrotask(() => emit({ t: 'hello', snapshot }))

  // El otro socio "se conecta" y escribe al cabo de un rato, para ver el chat en vivo.
  timers.push(window.setTimeout(() => emit({ t: 'online', users: [me.id, partner.id] }), 4000))
  timers.push(window.setTimeout(() => emit({ t: 'typing', botId: 'chief-of-staff', userId: partner.id, on: true }), 14000))
  timers.push(window.setTimeout(() => {
    emit({ t: 'typing', botId: 'chief-of-staff', userId: partner.id, on: false })
    const text = '¿Puedes recordarnos también lo de la factura de Grupo Lumen el viernes?'

    add('chief-of-staff', { id: uid('m'), role: 'user', authorId: partner.id, text, ts: Date.now() })
    void reply('chief-of-staff', text)
  }, 18000))

  return {
    send(cmd: ClientCommand) {
      switch (cmd.t) {
        case 'send':
          add(cmd.botId, {
            id: uid('m'), role: 'user', authorId: me.id, text: cmd.text, ts: Date.now(),
            attachments: cmd.uploads?.map(u => ({ id: uid('f'), name: u.name, kind: u.type.startsWith('image/') ? 'image' as const : 'file' as const, size: u.size, preview: u.preview }))
          })
          void reply(cmd.botId, cmd.text, cmd.uploads)
          break
        case 'user.save': {
          const { t: _t, id, password: _password, avatar, ...rest } = cmd
          const patch = { ...rest, ...(avatar !== undefined ? { avatar: avatar ?? undefined } : {}) }

          users = id
            ? users.map(u => (u.id === id ? { ...u, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } : u))
            : [...users, { id: uid('u'), name: cmd.name ?? 'Nuevo', username: cmd.username, color: '#D84F8B', avatar: avatar ?? undefined, admin: !!cmd.admin }]
          emit({ t: 'users', users })
          emit({ t: 'toast', text: id ? 'Cambios guardados.' : `Cuenta de ${cmd.name} creada.` })
          break
        }
        case 'user.delete':
          users = users.filter(u => u.id !== cmd.id)
          emit({ t: 'users', users })
          emit({ t: 'toast', text: 'Cuenta borrada.' })
          break
        case 'bot.save': {
          const { t: _t, id, ...data } = cmd

          if (id) {
            bots = bots.map(b => (b.id === id ? { ...b, ...data } : b))
          } else {
            const fresh = { id: uid('bot'), ...data }

            bots = [...bots, fresh]
            messages[fresh.id] = []
          }

          emit({ t: 'bots', bots })
          emit({ t: 'toast', text: id ? 'Cambios guardados.' : `${cmd.name} ya está en el equipo.` })
          break
        }
        case 'bot.delete':
          bots = bots.filter(b => b.id !== cmd.id)
          emit({ t: 'bots', bots })
          emit({ t: 'toast', text: 'Bot borrado.' })
          break
        case 'routine': {
          const i = routines.findIndex(r => r.id === cmd.id)

          if (i !== -1) {
            if (cmd.action === 'remove') { routines.splice(i, 1) } else { routines[i] = { ...routines[i]!, enabled: cmd.action === 'resume' } }
            emit({ t: 'routines', routines: [...routines] })
          }

          break
        }
        case 'approve':
        case 'clarify': {
          const resolve = waiting.get(cmd.reqId)

          waiting.delete(cmd.reqId)
          emit({ t: 'req.done', id: cmd.reqId })
          resolve?.(cmd.t === 'approve' ? cmd.choice : (cmd.answer ?? 'las dos'))
          break
        }
        default:
          break
      }
    },
    close() {
      closed = true
      timers.forEach(clearTimeout)
    }
  }
}
