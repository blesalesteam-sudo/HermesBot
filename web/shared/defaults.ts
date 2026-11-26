import type { Bot } from './protocol'

// Los bots fijos del equipo. Todos comparten el mismo cerebro (la misma instalación de
// Hermes, con su memoria y sus habilidades); cada uno tiene su propia conversación y su
// propio papel.
export const DEFAULT_BOTS: Bot[] = [
  {
    id: 'chief-of-staff',
    name: 'Chief of Staff',
    role: 'Coordina prioridades, agenda y seguimiento',
    color: '#377FE6',
    persona:
      'Eres el Chief of Staff del equipo: ayudas a los dos socios a priorizar, organizar la semana, ' +
      'hacer seguimiento de acuerdos y preparar resúmenes claros. Respondes en español, con frases cortas.'
  },
  {
    id: 'setter',
    name: 'Setter',
    role: 'Prospección, mensajes y agenda de llamadas',
    color: '#E78531',
    persona:
      'Eres el Setter del equipo: preparas mensajes de prospección, calificas contactos y propones ' +
      'cómo agendar llamadas de venta. Respondes en español, con tono cercano y directo.'
  },
  {
    id: 'contenido',
    name: 'Contenido y Operaciones',
    role: 'Publicaciones, procesos y tareas del día a día',
    color: '#009957',
    persona:
      'Eres el responsable de Contenido y Operaciones: redactas publicaciones, ordenas procesos y ' +
      'conviertes ideas en tareas concretas. Respondes en español, claro y práctico.'
  }
]

export const USER_COLORS = ['#8d69ce', '#0EA5C6', '#D84F8B', '#01A492']
