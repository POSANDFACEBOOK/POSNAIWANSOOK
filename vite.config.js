import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Strip console.log/info/debug + debugger from production bundle (keeps console.error/warn)
    drop: ['debugger'],
    pure: ['console.log', 'console.info', 'console.debug'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
