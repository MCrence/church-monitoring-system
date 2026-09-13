import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: {
      cert: fs.readFileSync('../server/certs/lan.crt'),
      key: fs.readFileSync('../server/certs/lan.key'),
    },
    proxy: {
      '/api': { target: 'https://localhost:3000', secure: false },
      '/uploads': { target: 'https://localhost:3000', secure: false },
    },
  },
})
