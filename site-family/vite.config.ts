import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Static build (dist/) for Cloudflare static hosting. The gate engine is the same pure module the
// old site uses (../site/engine/policy.js), imported through @engine so there is one copy of it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@engine': path.resolve(import.meta.dirname, '../site/engine'),
      '@data': path.resolve(import.meta.dirname, '../site/data'),
    },
  },
  server: { fs: { allow: ['..'] } },
})
