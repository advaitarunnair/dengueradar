import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Vercel serves the app at the domain root; GitHub Pages serves it under /dengueradar/.
  base: process.env.VERCEL ? '/' : '/dengueradar/',
  plugins: [react(), tailwindcss()],
})
