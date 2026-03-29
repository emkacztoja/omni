import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Required for standard Electron UI resolution
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  }
})
