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
  // Serve over plain http on the LAN so iPad/Safari can print to the http LAN
  // printer (https→http "mixed content" is blocked on iOS; http→http is allowed).
  // `host: true` binds 0.0.0.0 so the machine's LAN IP is reachable from the iPads.
  preview: {
    host: true,
    port: 8080,
  },
  server: {
    host: true,
    port: 8080,
  },
})
