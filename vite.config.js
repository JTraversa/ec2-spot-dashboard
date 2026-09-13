import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/cloud-pricing/',
  // Two pages: the cloud pricing dashboard (index.html) and the free GPU
  // rental headline (gpu.html), which reads public/data/gpu/*.json.
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), gpu: resolve(__dirname, 'gpu.html') } } },
})
