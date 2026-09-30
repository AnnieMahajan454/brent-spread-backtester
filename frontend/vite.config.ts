import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// in dev, /api calls go to the local FastAPI server (uvicorn on :8000)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
