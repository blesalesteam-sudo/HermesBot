import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build` → la app real (habla con el servidor).
// `npm run build:demo` → un único archivo HTML con datos de prueba, para enseñar el diseño.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } } }
}))
