import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// Proxy API calls during local dev to avoid CORS issues when hitting the
// remote backend. The frontend should talk to `/api` and let Vite forward
// requests (including websockets) to the real service.
const DEV_API_TARGET = 'https://mississauga-demo.azule.xyz'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: DEV_API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
