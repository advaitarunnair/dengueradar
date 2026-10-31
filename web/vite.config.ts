import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Vercel serves the app at the domain root; GitHub Pages serves it under /dengueradar/.
  base: process.env.VERCEL ? '/' : '/dengueradar/',
  plugins: [react(), tailwindcss()],
  // scripts/dev_local.ts: real API handlers on a throwaway database.
  server: process.env.API_PROXY ? { proxy: { '/api': process.env.API_PROXY } } : undefined,
})
