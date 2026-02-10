import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/maintenance/',
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 1000
    },
    // Proxy API requests to maintenance backend
    proxy: {
      '/maintenance/api': {
        target: 'http://maintenance-backend-dev:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/maintenance\/api/, '/api')
      }
    }
  }
})
