// Convierte la demo de un solo archivo (dist-demo/index.html) en un fragmento sin
// <html>/<head>/<body>, que es lo que piden algunas plataformas para publicar páginas.
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input = 'dist-demo/index.html', output = 'dist-demo/vista-previa.html'] = process.argv
const html = readFileSync(input, 'utf8')
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m => m[0]).join('\n')
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map(m => m[0])
const boot = scripts.filter(s => !s.includes('type="module"')).join('\n')
const app = scripts.filter(s => s.includes('type="module"')).join('\n')

writeFileSync(output, `<title>hermesBot vista previa</title>\n${boot}\n${styles}\n<div id="root"></div>\n${app}\n`)
console.log('escrito', output)
