import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri usa a porta fixa 1420 (tauri.conf.json -> build.devUrl)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
})
