import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      // Model Arena bridge (arena/bridge.ts): one port is enough for the page, even on a remote machine
      '/arena-bridge': { target: 'http://127.0.0.1:7790', rewrite: (p) => p.replace(/^\/arena-bridge/, '') },
    },
  },
})
